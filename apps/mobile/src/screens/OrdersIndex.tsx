import React, { useState } from 'react'
import { FlatList, RefreshControl } from 'react-native'
import { Link, usePage, useVisit } from '@gangway/client'
import type { PageProps } from '../gangway'
import { Body, Button, Card, Screen, Title } from '../ui'

export default function OrdersIndex({ orders }: PageProps<'Orders/Index'>) {
  const { reload } = usePage()
  const visit = useVisit()
  const [refreshing, setRefreshing] = useState(false)

  return (
    <Screen>
      <Title>Orders</Title>
      <Button label="New order" onPress={() => visit('/orders/new')} />
      <FlatList
        data={orders}
        keyExtractor={(o) => String(o.id)}
        contentContainerStyle={{ gap: 10, paddingTop: 10 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true)
              await reload()
              setRefreshing(false)
            }}
          />
        }
        renderItem={({ item }) => (
          <Link href={`/orders/${item.id}`}>
            <Card>
              <Body>{item.title}</Body>
              <Body dim>
                ¥{item.amount.toLocaleString()} · {item.createdAt}
              </Body>
            </Card>
          </Link>
        )}
      />
    </Screen>
  )
}

import React from 'react'
import { ActivityIndicator, View } from 'react-native'
import { router } from 'expo-router'
import type { FallbackProps } from '@gangway/client'
import { Body, Button, Card, Screen, Title, colors } from '../ui'

/**
 * The wall, made visible. Rendered when the BFF references a screen this
 * bundle can't resolve (missing-component), refuses to serve a stale bundle
 * (update-required), or when a route's page-object was lost and is being
 * re-fetched (rehydrating). A production app wires the update button to
 * Updates.fetchUpdateAsync() → Updates.reloadAsync().
 */
export default function Fallback({ reason, component, info, retry }: FallbackProps) {
  // Transient: store entry lost (reload/cold-start), re-fetching in place.
  if (reason === 'rehydrating') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, gap: 16 }}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Body dim>Restoring…</Body>
      </View>
    )
  }

  return (
    <Screen>
      <Title>Update available</Title>
      <Card>
        {reason === 'missing-component' && (
          <Body>
            The server sent a screen ({component}) that this version of the app doesn't include
            yet. In production this triggers an over-the-air update.
          </Body>
        )}
        {reason === 'update-required' && (
          <Body>
            {info?.message ?? `This feature needs app bundle ${info?.minBundle ?? '(newer)'} or later.`}
          </Body>
        )}
        {reason === 'missing-page' && <Body>This screen's data is no longer available.</Body>}
      </Card>
      <Button label="Check for update (demo: no-op)" onPress={() => retry?.()} />
      <Button label="Go back" onPress={() => router.canGoBack() && router.back()} />
    </Screen>
  )
}

import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { useVisit } from '@gangway/client'
import { colors } from '../src/ui'

/**
 * Boot screen: performs the initial protocol visit. The BFF decides what the
 * first screen is (here '/'), and `replace` makes it the navigation root.
 */
export default function Boot() {
  const visit = useVisit()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    visit('/', { intent: 'replace' }).then((r) => {
      if (!r.ok && r.kind === 'error') {
        setError(`Cannot reach the BFF: ${r.message}\n\nIs apps/server running? (npm run dev:server)`)
      }
    })
  }, [visit])

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 24 }}>
      {error ? (
        <Text style={{ color: colors.danger, fontSize: 15 }}>{error}</Text>
      ) : (
        <ActivityIndicator color={colors.accent} size="large" />
      )}
    </View>
  )
}

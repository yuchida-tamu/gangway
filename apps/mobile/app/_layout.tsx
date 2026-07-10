import React from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GangwayProvider } from '@gangway/client'
import { gangway } from '../src/gangway'
import { registry } from '../src/registry'
import Fallback from '../src/screens/Fallback'
import { colors } from '../src/ui'

export default function RootLayout() {
  return (
    <GangwayProvider client={gangway} registry={registry} fallback={Fallback}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitle: 'Gangway',
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="s/[key]" />
        <Stack.Screen name="m/[key]" options={{ presentation: 'modal', headerTitle: '' }} />
      </Stack>
    </GangwayProvider>
  )
}

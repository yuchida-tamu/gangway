import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { GangwayScreen } from '@gangway/client'

/** Card-presented protocol screens. The BFF picks the component; the page
 *  object is resolved from the client store via the `key` route param. `u`
 *  carries the page URL so the screen can rehydrate after a store loss. */
export default function StackScreen() {
  const { key, u } = useLocalSearchParams<{ key: string; u?: string }>()
  return <GangwayScreen pageKey={String(key)} url={u} />
}

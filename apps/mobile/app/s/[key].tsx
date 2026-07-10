import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { GangwayScreen } from '@gangway/client'

/** Card-presented protocol screens. The BFF picks the component; the page
 *  object is resolved from the client store via the `key` route param. */
export default function StackScreen() {
  const { key } = useLocalSearchParams<{ key: string }>()
  return <GangwayScreen pageKey={String(key)} />
}

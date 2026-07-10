import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { GangwayScreen } from '@gangway/client'

/** Modal-presented protocol screens (nav action 'modal'). */
export default function ModalScreen() {
  const { key } = useLocalSearchParams<{ key: string }>()
  return <GangwayScreen pageKey={String(key)} />
}

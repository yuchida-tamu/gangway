import React from 'react'
import { TextInput } from 'react-native'
import { useForm } from '@gangway/client'
import type { PageProps } from '../gangway'
import { Body, Button, ErrorText, Screen, Title, colors, styles } from '../ui'

export default function OrdersNew({ defaults }: PageProps<'Orders/New'>) {
  const form = useForm({ title: defaults.title, amount: defaults.amount })

  return (
    <Screen>
      <Title>New order</Title>
      <Body dim>Title</Body>
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.dim}
        placeholder="What are you ordering?"
        value={form.data.title}
        onChangeText={(t) => form.setData('title', t)}
      />
      {form.errors.title ? <ErrorText>{form.errors.title}</ErrorText> : null}

      <Body dim>Amount (¥)</Body>
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.dim}
        placeholder="0"
        keyboardType="numeric"
        value={form.data.amount ? String(form.data.amount) : ''}
        onChangeText={(t) => form.setData('amount', Number(t) || 0)}
      />
      {form.errors.amount ? <ErrorText>{form.errors.amount}</ErrorText> : null}

      <Button
        label={form.processing ? 'Creating…' : 'Create order'}
        disabled={form.processing}
        onPress={() => form.post('/orders')}
      />
      <Body dim>
        Validation runs on the server. Errors land in form.errors; success 303s to the new
        order's screen.
      </Body>
    </Screen>
  )
}

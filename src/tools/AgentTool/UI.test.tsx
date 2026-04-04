import { describe, expect, test, mock } from 'bun:test'
import * as React from 'react'

const getMainLoopModelMock = mock(() => 'gpt-5.4')
const parseUserSpecifiedModelMock = mock((model: string) =>
  model === 'inherit' ? 'gpt-5.4' : model,
)
const renderModelNameMock = mock((model: string) => model.toUpperCase())

mock.module('../../utils/model/model.js', () => ({
  getMainLoopModel: getMainLoopModelMock,
  parseUserSpecifiedModel: parseUserSpecifiedModelMock,
  renderModelName: renderModelNameMock,
}))

const { renderToolUseTag } = await import('./UI.js')

describe('renderToolUseTag', () => {
  test('shows inherit with the resolved parent model', () => {
    const node = renderToolUseTag({ model: 'inherit' }) as React.ReactElement
    const boxChild = React.Children.toArray(node.props.children)[0] as React.ReactElement
    const textChild = boxChild.props.children as React.ReactElement

    expect(textChild.props.children).toBe('inherit (GPT-5.4)')
  })

  test('shows explicit model labels when they differ from the parent', () => {
    const node = renderToolUseTag({ model: 'gpt-5.4-mini' }) as React.ReactElement
    const boxChild = React.Children.toArray(node.props.children)[0] as React.ReactElement
    const textChild = boxChild.props.children as React.ReactElement

    expect(textChild.props.children).toBe('GPT-5.4-MINI')
  })

  test('returns null when explicit model matches the parent model', () => {
    expect(renderToolUseTag({ model: 'gpt-5.4' })).toBeNull()
  })
})

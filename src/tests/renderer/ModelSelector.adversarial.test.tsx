// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelSelector } from '@/renderer/src/components/chat/ModelSelector'

const models = [
  { provider: 'openai', id: 'gpt-4o', name: 'GPT 4o' },
  { provider: 'openai', id: 'gpt-4o-mini', name: 'GPT 4o Mini' },
  { provider: 'openrouter', id: 'same-id', name: 'OpenRouter shared' },
  { provider: 'custom', id: 'same-id', name: 'Custom name' },
  { provider: 'openrouter', id: 'openai/gpt-4o-mini', name: 'GPT 4o Mini' },
]

async function openSelector() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /choose model/i }))
  return user
}

describe('ModelSelector adversarial behavior', () => {
  it('searches across model names and ids without leaking models from another provider', async () => {
    render(<ModelSelector activeModel={models[0]} modelList={models} setModel={vi.fn()} />)
    const user = await openSelector()

    await user.type(screen.getByRole('combobox'), 'gpt-4o mini')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option')).toHaveTextContent('GPT 4o Mini')
    expect(screen.queryByText('openai/gpt-4o-mini')).not.toBeInTheDocument()
  })

  it('uses the exact provider and id when two providers expose the same model id', async () => {
    const setModel = vi.fn()
    render(<ModelSelector activeModel={models[0]} modelList={models} setModel={setModel} />)
    const user = await openSelector()

    await user.click(screen.getByRole('button', { name: 'custom' }))
    await user.click(screen.getByRole('option', { name: /Custom name/ }))
    expect(setModel).toHaveBeenCalledWith('custom', 'same-id')
    expect(setModel).toHaveBeenCalledTimes(1)
  })

  it('marks the current model only for its provider when ids collide', async () => {
    render(<ModelSelector activeModel={models[2]} modelList={models} setModel={vi.fn()} />)
    const user = await openSelector()
    const dialog = screen.getByRole('dialog', { name: 'Choose a model' })
    await user.click(within(dialog).getByRole('button', { name: 'OpenRouter' }))
    expect(screen.getByText('Current').closest('[role="option"]')).toHaveAttribute('data-value', '["openrouter","same-id"]')
    await user.click(within(dialog).getByRole('button', { name: 'custom' }))
    expect(screen.queryByText('Current')).not.toBeInTheDocument()
  })

  it('does not retain a stale search when changing providers, including after no results', async () => {
    render(<ModelSelector activeModel={models[0]} modelList={models} setModel={vi.fn()} />)
    const user = await openSelector()
    const dialog = screen.getByRole('dialog', { name: 'Choose a model' })
    const providers = within(dialog).getByRole('navigation', { name: 'Model providers' })

    await user.type(screen.getByRole('combobox'), 'does-not-exist')
    expect(screen.getByText('No models match your search')).toBeInTheDocument()
    await user.click(within(providers).getByRole('button', { name: 'OpenRouter' }))

    expect(screen.getByRole('combobox')).toHaveValue('')
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByRole('option', { name: /OpenRouter shared/ })).toBeInTheDocument()
  })

  it('keeps the trigger disabled while the selector is unavailable', async () => {
    const user = userEvent.setup()
    render(<ModelSelector activeModel={null} modelList={models} setModel={vi.fn()} disabled />)
    const trigger = screen.getByRole('button', { name: /choose model/i })
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

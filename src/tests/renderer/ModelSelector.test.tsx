// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelSelector } from '@/renderer/src/components/chat/ModelSelector'

const models = [
  { provider: 'openai', id: 'shared-id', name: 'Shared model' },
  { provider: 'openrouter', id: 'shared-id', name: 'Shared model' },
  { provider: 'anthropic', id: 'claude-test', name: 'Claude Test' },
  { provider: 'google', id: 'gemini-test', name: 'Gemini Test' },
  { provider: 'custom-provider', id: 'local-model', name: 'Local Model' },
]

async function openSelector() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /choose model/i }))
  return user
}

describe('ModelSelector', () => {
  it('lists providers in a sidebar and shows only the active provider models', async () => {
    render(<ModelSelector activeModel={models[0]} modelList={models} setModel={vi.fn()} />)
    await openSelector()
    const dialog = screen.getByRole('dialog', { name: 'Choose a model' })
    for (const name of ['OpenAI', 'OpenRouter', 'Anthropic', 'Google', 'custom-provider']) {
      expect(within(dialog).getByRole('button', { name })).toBeInTheDocument()
    }
    expect(within(dialog).getAllByRole('option')).toHaveLength(1)
    expect(screen.queryByText('Claude Test')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'OpenAI' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('combobox')).toHaveFocus()
    expect(screen.getByText('Current').closest('[role="option"]')).toHaveAttribute('data-value', '["openai","shared-id"]')
  })

  it('switches providers, searches model IDs, and selects the exact provider/model pair', async () => {
    const setModel = vi.fn()
    render(<ModelSelector activeModel={models[0]} modelList={models} setModel={setModel} />)
    const user = await openSelector()
    await user.click(screen.getByRole('button', { name: 'OpenRouter' }))
    await user.type(screen.getByRole('combobox'), 'shared-id')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.queryByText('Current')).not.toBeInTheDocument()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(setModel).toHaveBeenCalledWith('openrouter', 'shared-id')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /choose model/i })).toHaveFocus()
  })

  it('shows a no-results state and clears search when reopened', async () => {
    const setModel = vi.fn()
    render(<ModelSelector activeModel={null} modelList={models} setModel={setModel} />)
    const user = await openSelector()
    await user.type(screen.getByRole('combobox'), 'no-such-model')
    expect(screen.getByText('No models match your search')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(setModel).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /choose model/i }))
    expect(screen.getByRole('combobox')).toHaveValue('')
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  it('shows an empty state and prevents opening when disabled', async () => {
    const { rerender } = render(<ModelSelector activeModel={null} modelList={[]} setModel={vi.fn()} disabled />)
    expect(screen.getByRole('button', { name: /choose model/i })).toBeDisabled()
    rerender(<ModelSelector activeModel={null} modelList={[]} setModel={vi.fn()} />)
    await openSelector()
    expect(screen.getByText('No models configured')).toBeInTheDocument()
  })

  it('keeps providers visible while searching and clears search when switching', async () => {
    render(<ModelSelector activeModel={models[0]} modelList={models} setModel={vi.fn()} />)
    const user = await openSelector()
    await user.type(screen.getByRole('combobox'), 'no-match')
    const sidebar = screen.getByRole('navigation', { name: 'Model providers' })
    expect(within(sidebar).getAllByRole('button')).toHaveLength(5)
    await user.click(within(sidebar).getByRole('button', { name: 'Anthropic' }))
    expect(screen.getByRole('combobox')).toHaveValue('')
    expect(screen.getByRole('option')).toHaveTextContent('Claude Test')
    expect(within(screen.getByRole('dialog')).queryByText('Shared model')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /choose model/i }))
    expect(screen.getByRole('button', { name: 'OpenAI' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('bundles provider logos and falls back if an image cannot load', () => {
    render(<ModelSelector activeModel={models[0]} modelList={models} setModel={vi.fn()} />)
    const button = screen.getByRole('button', { name: /choose model/i })
    const image = button.querySelector('img')!
    expect(image.getAttribute('src')).toMatch(/^(data:image\/svg\+xml|\/.*openai.*\.svg)/)
    fireEvent.error(image)
    expect(within(button).getByText('OP')).toBeInTheDocument()
  })
})

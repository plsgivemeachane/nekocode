// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NavBar } from '@/renderer/src/components/layout/NavBar'
import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import { createMockIPC, setupMockIPC, clearMockIPC } from '../__utils__/test-utils'

const zoom = { zoom: 1, zoomIn: vi.fn(), zoomOut: vi.fn(), resetZoom: vi.fn(), minZoom: .5, maxZoom: 2 }
const addProject = vi.fn(() => Promise.resolve())
vi.mock('@/renderer/src/hooks/useZoom', () => ({ useZoom: () => zoom }))
vi.mock('@/renderer/src/stores/project-store', () => ({ useProjectStore: () => ({ addProject, setGitOverlay: vi.fn(), state: { activeProjectPath: '/project' } }) }))

describe('NavBar responsive behavior', () => {
  beforeEach(() => { vi.clearAllMocks(); setupMockIPC(createMockIPC()) })
  afterEach(() => { clearMockIPC() })

  it('activates search by keyboard and retains the responsive label classes', async () => {
    const user = userEvent.setup()
    render(<TooltipProvider><NavBar /></TooltipProvider>)
    const search = screen.getByRole('button', { name: 'Search commands, files, and sessions' })
    expect(search).toHaveClass('w-8', 'lg:w-full', 'min-w-0')
    expect(screen.getByText('Search')).toHaveClass('hidden', 'lg:block')
    const event = vi.fn()
    window.addEventListener('nekocode:open-search', event)
    try {
      search.focus()
      await user.keyboard('{Enter}')
      expect(event).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('nekocode:open-search', event)
    }
  })

  it('retains structural classes for window controls and responsive zoom visibility', () => {
    render(<TooltipProvider><NavBar /></TooltipProvider>)
    expect(screen.getByRole('button', { name: 'Minimize' }).parentElement).toHaveClass('shrink-0')
    expect(screen.getByTitle('Zoom out (Ctrl+-)').parentElement).toHaveClass('hidden', 'lg:flex')
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Panel } from './Panel'

describe('Panel', () => {
  it('toggles open state', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <Panel title="Test Panel" open onToggle={onToggle}>
        <div>Content</div>
      </Panel>
    )

    await user.click(screen.getByRole('button', { name: /collapse/i }))
    expect(onToggle).toHaveBeenCalled()
  })
})

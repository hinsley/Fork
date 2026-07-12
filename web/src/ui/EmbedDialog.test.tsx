import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { addScene, createSystem } from '../system/model'
import { EmbedDialog } from './EmbedDialog'

vi.mock('../embed/EmbedCapturePreview', () => ({
  EmbedCapturePreview: () => <div data-testid="embed-preview" />,
}))

describe('EmbedDialog', () => {
  it('selects the active viewport and generates downloadable embed markup', () => {
    const result = addScene(createSystem({ name: 'Share_Me' }), 'Primary Scene')
    const system = {
      ...result.system,
      ui: { ...result.system.ui, selectedNodeId: result.nodeId },
    }
    render(
      <EmbedDialog
        open
        system={system}
        appTheme="light"
        onClose={vi.fn()}
      />
    )

    expect(screen.getByTestId('embed-preview')).toBeInTheDocument()
    expect(screen.getByDisplayValue('./Share_Me_embed.html')).toBeInTheDocument()
    const markup = (screen.getByTestId('embed-code') as HTMLTextAreaElement).value
    expect(markup).toContain('<iframe')
    expect(markup).not.toContain('fork-embed')
    expect(screen.queryByText('Reset view')).not.toBeInTheDocument()
    expect(screen.queryByText('Fullscreen')).not.toBeInTheDocument()
    const bundleDependencies = screen.getByRole('checkbox', {
      name: 'Bundle dependencies (Experimental)',
    })
    expect(bundleDependencies).not.toBeChecked()
    fireEvent.click(bundleDependencies)
    expect(bundleDependencies).toBeChecked()
    expect(screen.getByRole('button', { name: 'Download embed HTML' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } })
    expect(screen.getByLabelText('Theme')).toHaveValue('dark')
  })
})

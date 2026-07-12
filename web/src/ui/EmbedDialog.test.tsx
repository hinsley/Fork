import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { addScene, createSystem } from '../system/model'
import { EmbedDialog } from './EmbedDialog'

vi.mock('../embed/EmbedViewportStack', () => ({
  EmbedViewportStack: () => <div data-testid="embed-preview" />,
}))

describe('EmbedDialog', () => {
  it('selects the active viewport and generates downloadable embed markup', () => {
    const result = addScene(createSystem({ name: 'Share_Me' }), 'Primary Scene')
    const system = {
      ...result.system,
      ui: { ...result.system.ui, selectedNodeId: result.nodeId },
    }
    const onExport = vi.fn()
    render(
      <EmbedDialog
        open
        system={system}
        onClose={vi.fn()}
        onExport={onExport}
      />
    )

    expect(screen.getByTestId('embed-preview')).toBeInTheDocument()
    expect(screen.getByDisplayValue('./Share_Me.zip')).toBeInTheDocument()
    expect((screen.getByDisplayValue(/viewports=/) as HTMLTextAreaElement).value).toContain(
      result.nodeId
    )
    expect(screen.queryByText('Reset view')).not.toBeInTheDocument()
    expect(screen.queryByText('Fullscreen')).not.toBeInTheDocument()
    expect((screen.getByTestId('embed-code') as HTMLTextAreaElement).value).not.toContain(
      'controls='
    )

    fireEvent.click(screen.getByText('Download system ZIP'))
    expect(onExport).toHaveBeenCalledTimes(1)
  })
})

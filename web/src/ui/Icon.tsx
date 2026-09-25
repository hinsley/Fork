export type IconName =
  | 'fork'
  | 'systems'
  | 'settings'
  | 'sliders'
  | 'folder'
  | 'plus'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-left'
  | 'first'
  | 'last'
  | 'external'
  | 'plot'
  | 'eye'
  | 'eye-off'
  | 'close'
  | 'more'
  | 'maximize'
  | 'minimize'
  | 'search'
  | 'copy'
  | 'play'
  | 'pause'
  | 'trash'
  | 'sun'
  | 'moon'
  | 'help'
  | 'pencil'
  | 'upload'
  | 'download'
  | 'function'
  | 'panel-left'
  | 'panel-right'
  | 'orbit'
  | 'equilibrium'
  | 'cycle'
  | 'branch'
  | 'grid'
  | 'measure'
  | 'isocline'
  | 'particles'
  | 'scene'
  | 'diagram'
  | 'analysis'
  | 'manifold'
  | 'palette'
  | 'code'

const paths: Record<IconName, string> = {
  fork: 'M4 18c5 0 5-12 10-12h6M4 18c5 0 5-4 10-4h6M4 18h16',
  systems: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
  sliders: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
  folder: 'M3 7V5h6l2 3h10v12H3V7Z',
  plus: 'M12 5v14M5 12h14',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-right': 'm9 6 6 6-6 6',
  'chevron-left': 'm15 6-6 6 6 6',
  first: 'm17 6-6 6 6 6M7 6v12',
  last: 'm7 6 6 6-6 6M17 6v12',
  external: 'M14 3h7v7M21 3 10 14M10 3H3v18h18v-7',
  plot: 'M4 3v17h17M7 15l4-7 4 5 5-9',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  'eye-off': 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.6 4.9-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2',
  close: 'M6 6l12 12M18 6 6 18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  maximize: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  minimize: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 5 5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  play: 'M7 4v16l13-8L7 4Z',
  pause: 'M8 5v14M16 5v14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  function: 'M14 4h-1a3 3 0 0 0-3 3v12a2 2 0 0 1-2 2H7M7 11h8M15 14l5 5M20 14l-5 5',
  'panel-left': 'M3 4h18v16H3zM9 4v16',
  'panel-right': 'M3 4h18v16H3zM15 4v16',
  orbit: 'M3 17c3-9 9-12 13-10s3 8-3 10-9-2-6-6',
  equilibrium: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 3v3M12 18v3M3 12h3M18 12h3',
  cycle: 'M12 20c4.4 0 8-3.6 8-8s-3.6-8-8-8-8 3.6-8 8M4 12l-2-2M4 12l2-2',
  branch: 'M4 20c4-12 8-12 16-16M4 20c6-4 10-4 16-4',
  grid: 'M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16',
  measure: 'M3 20h18M5 20v-6M9 20V8M13 20v-9M17 20V5',
  isocline: 'M3 17c4 0 5-10 9-10s5 10 9 10',
  particles: 'M6 7h.01M12 5h.01M18 8h.01M8 13h.01M15 12h.01M5 18h.01M11 18h.01M18 17h.01',
  scene: 'M3 4h18v16H3zM7 16l3-5 3 3 2-3 3 5',
  diagram: 'M4 3v17h17M7 16c3 0 4-8 7-8s3 4 6 4',
  analysis: 'M4 3v17h17M8 14h.01M11 10h.01M14 12h.01M17 7h.01',
  manifold: 'M3 18c4-2 5-10 9-12M12 6c4 2 5 10 9 12M3 18h18',
  palette: 'M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.6 0-.9.7-1.7 1.7-1.7H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8ZM7.5 11h.01M10 7.5h.01M14.5 7.5h.01',
  code: 'm8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14',
}

export function Icon({
  name,
  className = '',
  size = 16,
}: {
  name: IconName
  className?: string
  size?: number
}) {
  return (
    <svg className={`ui-icon ${className}`.trim()} width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  )
}

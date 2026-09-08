type IconName = 'fork' | 'systems' | 'settings' | 'folder' | 'plus' | 'chevron-down' | 'external' | 'plot'

const paths: Record<IconName, string> = {
  fork: 'M4 18c5 0 5-12 10-12h6M4 18c5 0 5-4 10-4h6M4 18h16',
  systems: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
  folder: 'M3 7V5h6l2 3h10v12H3V7Z',
  plus: 'M12 5v14M5 12h14',
  'chevron-down': 'm6 9 6 6 6-6',
  external: 'M14 3h7v7M21 3 10 14M10 3H3v18h18v-7',
  plot: 'M4 3v17h17M7 15l4-7 4 5 5-9',
}

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg className={`ui-icon ${className}`.trim()} width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  )
}

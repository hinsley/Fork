import { useState } from 'react'
import './App.css'
import { Box } from '@mui/material'

import ODEs from './components/ODEs.tsx'
import StateSpace from './components/StateSpace.tsx'
import TopBar from './components/TopBar.tsx'

export default function App() {
  const [currentView, setCurrentView] = useState('state-space')

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar setCurrentView={setCurrentView} />
      <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        <Box sx={{ flex: 2, overflow: 'auto' }}>
          {(() => {
            switch (currentView) {
              case 'state-space':
                return <StateSpace />
              case 'equations':
                return <ODEs />
              default:
                return null
            }
          })()}
        </Box>
      </Box>
    </Box>
  )
}
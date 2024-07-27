import { useState } from 'react'
import './App.css'
import { Box } from '@mui/material'
import { compile } from 'mathjs'

import ODEEditor, { Equation } from './components/ODEEditor.tsx'
import StateSpace from './components/StateSpace.tsx'
import TopBar from './components/TopBar.tsx'

export default function App() {
  const [currentView, setCurrentView] = useState('state-space')
  const [equations, setEquations] = useState<Equation[]>([
    { variable: 'x', expression: '10*(y-x)' },
    { variable: 'y', expression: 'x*(28-z)-y' },
    { variable: 'z', expression: 'x*y-8/3*z' }
  ])
  // Compile equations.
  for (const equation of equations) {
    equation.compiled = compile(equation.expression)
  }

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar setCurrentView={setCurrentView} />
      <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        <Box sx={{ flex: 2, overflow: 'auto' }}>
          {(() => {
            switch (currentView) {
              case 'state-space':
                return <StateSpace equations={equations} />
              case 'equations':
                return <ODEEditor equations={equations} setEquations={setEquations} />
              default:
                return <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><h1>Not implemented</h1></Box>
            }
          })()}
        </Box>
      </Box>
    </Box>
  )
}
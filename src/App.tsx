import { useState } from 'react'
import './App.css'
import { Box } from '@mui/material'
import { compile } from 'mathjs'

import AttractorAnalysis from './components/AttractorAnalysis/AttractorAnalysis.tsx'
import ODEEditor, { Equation, Parameter } from './components/ODEEditor.tsx'
import StateSpace from './components/StateSpace.tsx'
import Systems from './components/Systems.tsx'
import TopBar from './components/TopBar.tsx'

export default function App() {
  const [currentView, setCurrentView] = useState('state-space')
  const [equations, setEquations] = useState<Equation[]>([
    { variable: "x", expression: "s*(y-x)" },
    { variable: "y", expression: "x*(r-z)-y" },
    { variable: "z", expression: "x*y-b*z" }
  ])
  const [parameters, setParameters] = useState<Parameter[]>([
    { name: "s", value: 10 },
    { name: "b", value: 8/3 },
    { name: "r", value: 28 }
  ])
  // Compile equations.
  for (const equation of equations) {
    equation.compiled = compile(equation.expression)
  }

  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar setCurrentView={setCurrentView} />
      <Box sx={{ display: "flex", flexGrow: 1, overflow: "hidden" }}>
        <Box sx={{ flex: 2, overflow: "auto" }}>
          {(() => {
            switch (currentView) {
              case "state-space":
                return <StateSpace equations={equations} parameters={parameters} />
              case "equations":
                return <ODEEditor equations={equations} setEquations={setEquations} parameters={parameters} setParameters={setParameters} />
              case "attractor-analysis":
                return <AttractorAnalysis equations={equations} parameters={parameters} />
              case "systems":
                return <Systems equations={equations} setEquations={setEquations} parameters={parameters} setParameters={setParameters} />
              default:
                return <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}><h1>Not implemented</h1></Box>
            }
          })()}
        </Box>
      </Box>
    </Box>
  )
}
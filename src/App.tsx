import { useState } from "react"
import "./App.css"
import { Box } from "@mui/material"
import { compile } from "mathjs"

import ODEEditor, { Equation, Parameter } from "./components/ODEEditor"
import StateSpace, { StateSpaceSettings, defaultStateSpaceSettings } from "./components/StateSpace"
import Continuation from "./components/Continuation/Continuation"
import { StateEntity } from "./components/Continuation/StateEntities/StateEntitiesMenu"
import { ParameterSet } from "./components/Continuation/ParameterSets/ParameterSetsMenu"
import BifurcationDiagram from "./components/BifurcationDiagram"
import AttractorAnalysis from "./components/AttractorAnalysis/AttractorAnalysis"
import Systems from "./components/Systems"
import Settings from "./components/Settings"
import TopBar from "./components/TopBar"

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

  const [stateEntities, setStateEntities] = useState<StateEntity[]>([])
  const [parameterSets, setParameterSets] = useState<ParameterSet[]>([])
  const [stateSpaceSettings, setStateSpaceSettings] = useState<StateSpaceSettings>(defaultStateSpaceSettings)

  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar setCurrentView={setCurrentView} />
      <Box sx={{ display: "flex", flexGrow: 1, overflow: "hidden" }}>
        <Box sx={{ flex: 2, overflow: "auto" }}>
          {(() => {
            switch (currentView) {
              case "state-space":
                return <StateSpace
                  equations={equations}
                  parameters={parameters}
                  stateEntities={stateEntities}
                  settings={stateSpaceSettings}
                />
              case "equations":
                return <ODEEditor
                  equations={equations}
                  setEquations={setEquations}
                  parameters={parameters}
                  setParameters={setParameters}
                />
              case "continuation":
                return <Continuation
                  equations={equations}
                  parameters={parameters}
                  stateSpaceSettings={stateSpaceSettings}
                  stateEntities={stateEntities}
                  setStateEntities={setStateEntities}
                  parameterSets={parameterSets}
                  setParameterSets={setParameterSets}
                />
              case "bifurcation-diagram":
                return <BifurcationDiagram
                  equations={equations}
                  parameters={parameters}
                  parameterSets={parameterSets}
                />
              case "attractor-analysis":
                return <AttractorAnalysis
                  equations={equations}
                  parameters={parameters}
                />
              case "systems":
                return <Systems
                  equations={equations}
                  setEquations={setEquations}
                  parameters={parameters}
                  setParameters={setParameters}
                  setStateSpaceSettings={setStateSpaceSettings}
                />
              case "settings":
                return <Settings
                  equations={equations}
                  stateSpaceSettings={stateSpaceSettings}
                  setStateSpaceSettings={setStateSpaceSettings}
                />
              default:
                return <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%"
                  }}>
                    <h1>Not implemented</h1>
                  </Box>
            }
          })()}
        </Box>
      </Box>
    </Box>
  )
}
import { useState } from 'react'
import { Button } from '@mui/material'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <h1>Fork</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
      </div>
      <div>
        <Button variant="contained">Hello World</Button>
      </div>
    </>
  )
}

export default App
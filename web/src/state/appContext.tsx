import { createContext, useContext } from 'react'
import type { AppContextValue } from './appState'

export const AppContext = createContext<AppContextValue | null>(null)

export const useAppContext = () => {
  const ctx = useContext(AppContext)
  if (!ctx) {
    throw new Error('useAppContext must be used within AppProvider')
  }
  return ctx
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Shell } from './ui/Shell'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
)

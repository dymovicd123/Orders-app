import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const CHUNK_RELOAD_KEY = 'orders-app:vite-preload-reload-at'

window.addEventListener('vite:preloadError', (event) => {
  const previousReloadAt = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0)
  if (Date.now() - previousReloadAt < 15_000) return
  event.preventDefault()
  window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

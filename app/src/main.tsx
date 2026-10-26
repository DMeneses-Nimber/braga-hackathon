import '@fontsource-variable/inter'
import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { Toaster } from 'sonner'

import { App } from './App.js'
import { AppProvider } from './data.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
        <Toaster position="bottom-right" theme="system" richColors closeButton />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
)

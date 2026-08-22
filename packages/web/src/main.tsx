import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App.js'
import './styles/app.css'

const client = new QueryClient({
  defaultOptions: {
    queries: {
      // The mirror is refreshed explicitly, not by polling: there is no delta endpoint upstream,
      // and a full corpus transfer per tick would degrade the very server being debugged.
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)

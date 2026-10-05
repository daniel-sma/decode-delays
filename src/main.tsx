import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BlueprintProvider } from '@blueprintjs/core'
import '@blueprintjs/core/lib/css/blueprint.css'
import '@blueprintjs/icons/lib/css/blueprint-icons.css'
import '@blueprintjs/table/lib/css/table.css'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BlueprintProvider>
      <App />
    </BlueprintProvider>
  </StrictMode>,
)

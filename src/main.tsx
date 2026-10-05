import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BlueprintProvider, FocusStyleManager } from '@blueprintjs/core'
import '@blueprintjs/core/lib/css/blueprint.css'
import '@blueprintjs/icons/lib/css/blueprint-icons.css'
import '@blueprintjs/table/lib/css/table.css'
import '@blueprintjs/select/lib/css/blueprint-select.css'
import App from './App'
import './styles.css'

// Focus rings only for keyboard users, so clicking tabs and buttons doesn't flash an outline.
FocusStyleManager.onlyShowFocusOnTabs()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BlueprintProvider>
      <App />
    </BlueprintProvider>
  </StrictMode>,
)

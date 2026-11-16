import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Self-hosted fonts. Each file only downloads the character sets a page
// actually uses (latin, and the vietnamese set for "Anh yêu em").
import '@fontsource-variable/newsreader/opsz.css'
import '@fontsource-variable/newsreader/opsz-italic.css'
import '@fontsource/be-vietnam-pro/400.css'
import '@fontsource/be-vietnam-pro/500.css'
import '@fontsource/be-vietnam-pro/600.css'
import '@fontsource/saira-extra-condensed/300.css'
import '@fontsource/saira-extra-condensed/500.css'

import './styles/tokens.css'
import './styles/base.css'
import './styles/film.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

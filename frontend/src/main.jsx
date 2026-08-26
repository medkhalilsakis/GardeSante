import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Couche de conception « Registre de garde » : jetons `--gs-*`, deux rôles
// typographiques et le socle de qualité (focus visible, mouvement réduit).
// Chargée après `index.css` pour en dériver les valeurs sans les remplacer.
import './styles/gardesante-design.css'
import App from './App.jsx'

// Appliquer la direction depuis localStorage si définie
const savedLang = (() => {
  try {
    const state = JSON.parse(localStorage.getItem('gardesante-ui') || '{}');
    return state?.state?.language || 'fr';
  } catch { return 'fr'; }
})();
document.documentElement.dir = savedLang === 'ar' ? 'rtl' : 'ltr';
document.documentElement.lang = savedLang;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

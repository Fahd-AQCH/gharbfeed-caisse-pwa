import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

/** Pas de StrictMode : évite le double-mount qui bloquait l'init Supabase au F5 en dev */
createRoot(document.getElementById('root')!).render(<App />);

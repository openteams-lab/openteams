import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from '@/App';
import './index.css';

const isMacOsTauri =
  '__TAURI__' in window && /Mac/.test(window.navigator.platform);

if (isMacOsTauri) {
  document.documentElement.dataset.tauriPlatform = 'macos';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

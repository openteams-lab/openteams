import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ClickToComponent } from 'click-to-react-component';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClickToComponent />
    <App />
  </React.StrictMode>
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { DevBanner } from './dev/DevBanner';

const container = document.getElementById('root');
if (!container) throw new Error('index.html is missing #root');

/*
 * The banner sits here rather than inside App so it also shows over the states
 * App returns before its routes exist: the identity check and a closed server.
 */
createRoot(container).render(
  <StrictMode>
    {import.meta.env.DEV && <DevBanner />}
    <App />
  </StrictMode>,
);

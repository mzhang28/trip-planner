import { BrowserRouter, Route, Routes } from 'react-router';
import { useIdentity } from './lib/useIdentity';
import { Agents } from './routes/Agents';
import { Connect } from './routes/Connect';
import { Join } from './routes/Join';
import { Settings } from './routes/Settings';
import { TripFields } from './routes/TripFields';
import { TripFiles } from './routes/TripFiles';
import { TripList } from './routes/TripList';
import { TripTodos } from './routes/TripTodos';
import { TripView } from './routes/TripView';

export function App() {
  const state = useIdentity();

  /*
   * Nothing renders until the browser knows who it is. Every screen below
   * fetches on mount, and the server mints a person for any request arriving
   * without a session — so letting them start first means several identities
   * being created at once and the browser keeping whichever reply landed last.
   */
  if (state.status === 'loading') {
    return <div className="min-h-dvh bg-page" aria-busy="true" />;
  }

  /*
   * A share link is an invitation, and the only way onto a closed server. The
   * route that redeems one therefore has to render for somebody who has no
   * account yet, which is exactly who is holding the link.
   */
  if (state.status === 'closed' && !window.location.pathname.startsWith('/join/')) {
    return <Closed />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TripList />} />
        <Route path="/t/:tripId" element={<TripView />} />
        <Route path="/t/:tripId/fields" element={<TripFields />} />
        <Route path="/t/:tripId/files" element={<TripFiles />} />
        <Route path="/t/:tripId/todos" element={<TripTodos />} />
        <Route path="/join/:token" element={<Join />} />
        <Route path="/connect" element={<Connect />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}

function Closed() {
  return (
    <div className="grid h-dvh place-items-center overflow-hidden bg-page px-6 text-center text-ink">
      <div>
        <h1 className="mb-2 text-xl">This server is not taking new people</h1>
        <p className="max-w-sm text-sm text-ink-secondary">
          Whoever runs it can send you a link to one of their trips, which will let you in.
        </p>
      </div>
    </div>
  );
}

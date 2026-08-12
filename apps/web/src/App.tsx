import { BrowserRouter, Route, Routes } from 'react-router';
import { useIdentity } from './lib/useIdentity';
import { Join } from './routes/Join';
import { TripFields } from './routes/TripFields';
import { TripFiles } from './routes/TripFiles';
import { TripList } from './routes/TripList';
import { TripTodos } from './routes/TripTodos';
import { TripView } from './routes/TripView';

export function App() {
  const identity = useIdentity();

  /*
   * Nothing renders until the browser knows who it is. Every screen below
   * fetches on mount, and the server mints a person for any request arriving
   * without a session — so letting them start first means several identities
   * being created at once and the browser keeping whichever reply landed last.
   */
  if (!identity) {
    return <div className="min-h-dvh bg-page" aria-busy="true" />;
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
      </Routes>
    </BrowserRouter>
  );
}

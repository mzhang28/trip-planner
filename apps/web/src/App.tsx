import { BrowserRouter, Route, Routes } from 'react-router';
import { Join } from './routes/Join';
import { TripList } from './routes/TripList';
import { TripView } from './routes/TripView';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TripList />} />
        <Route path="/t/:tripId" element={<TripView />} />
        <Route path="/join/:token" element={<Join />} />
      </Routes>
    </BrowserRouter>
  );
}

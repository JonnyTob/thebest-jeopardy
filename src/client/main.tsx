import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { SessionProvider } from './session';
import { AdminPage } from './pages/AdminPage';
import { DisplayPage } from './pages/DisplayPage';
import { PlayPage } from './pages/PlayPage';
import { HomePage } from './pages/HomePage';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/display" element={<SessionProvider role="display"><DisplayPage /></SessionProvider>} />
        <Route path="/play" element={<SessionProvider role="player"><PlayPage /></SessionProvider>} />
        <Route path="*" element={<main className="landing"><h1>Page not found</h1><Link to="/">Back to Quiz Night</Link></main>} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);

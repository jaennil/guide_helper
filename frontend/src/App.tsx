import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider } from './context/LanguageContext';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ProtectedAdminRoute } from './components/ProtectedAdminRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PWAStatus } from './components/PWAStatus';
import './App.css';

const Auth = lazy(() => import('./pages/Auth').then((module) => ({ default: module.Auth })));
const MapPage = lazy(() => import('./pages/MapPage').then((module) => ({ default: module.MapPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const ExplorePage = lazy(() => import('./pages/ExplorePage'));
const SharedMapPage = lazy(() => import('./pages/SharedMapPage').then((module) => ({ default: module.SharedMapPage })));
const EmbedMapPage = lazy(() => import('./pages/EmbedMapPage').then((module) => ({ default: module.EmbedMapPage })));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const BookmarksPage = lazy(() => import('./pages/BookmarksPage'));

function PageLoadingFallback() {
  return <div className="loading-screen" role="status">Загрузка...</div>;
}

function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <ThemeProvider>
      <LanguageProvider>
      <AuthProvider>
        <Suspense fallback={<PageLoadingFallback />}>
          <Routes>
            <Route path="/login" element={<Auth />} />
            <Route
              path="/map"
              element={
                <ProtectedRoute>
                  <MapPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedAdminRoute>
                  <AdminPage />
                </ProtectedAdminRoute>
              }
            />
            <Route path="/explore" element={<ExplorePage />} />
            <Route
              path="/bookmarks"
              element={
                <ProtectedRoute>
                  <BookmarksPage />
                </ProtectedRoute>
              }
            />
            <Route path="/shared/:token" element={<SharedMapPage />} />
            <Route path="/embed/:token" element={<EmbedMapPage />} />
            <Route path="/" element={<Navigate to="/map" replace />} />
          </Routes>
        </Suspense>
        <PWAStatus />
      </AuthProvider>
      </LanguageProvider>
      </ThemeProvider>
    </BrowserRouter>
      <Toaster position="bottom-left" toastOptions={{ duration: 3000 }} />
    </ErrorBoundary>
  );
}

export default App;

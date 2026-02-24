import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider } from './context/LanguageContext';
import { AuthProvider } from './context/AuthContext';
import { Auth } from './pages/Auth';
import { MapPage } from './pages/MapPage';
import ProfilePage from './pages/ProfilePage';
import ExplorePage from './pages/ExplorePage';
import { SharedMapPage } from './pages/SharedMapPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ProtectedAdminRoute } from './components/ProtectedAdminRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import AdminPage from './pages/AdminPage';
import BookmarksPage from './pages/BookmarksPage';
import './App.css';

function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <ThemeProvider>
      <LanguageProvider>
      <AuthProvider>
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
          <Route path="/" element={<Navigate to="/map" replace />} />
        </Routes>
      </AuthProvider>
      </LanguageProvider>
      </ThemeProvider>
    </BrowserRouter>
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
    </ErrorBoundary>
  );
}

export default App;

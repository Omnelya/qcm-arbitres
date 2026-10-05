import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import ProtectedRoute from './components/ProtectedRoute';
import RequireAuth from './components/RequireAuth';
import Login from './pages/Login';
import MotDePasseOublie from './pages/MotDePasseOublie';
import ActiverCompte from './pages/ActiverCompte';
import Confidentialite from './pages/Confidentialite';
import MonProfil from './pages/MonProfil';
import AdminDashboard from './pages/admin/Dashboard';
import Comptes from './pages/admin/Comptes';
import Structures from './pages/admin/Structures';
import Journal from './pages/admin/Journal';
import Reglages from './pages/admin/Reglages';
import FormateurDashboard from './pages/formateur/Dashboard';
import QuizForm from './pages/formateur/QuizForm';
import QuizQuestions from './pages/formateur/QuizQuestions';
import QuizResultats from './pages/formateur/QuizResultats';
import AttemptDetail from './pages/formateur/AttemptDetail';
import Groupes from './pages/formateur/Groupes';
import GroupMembers from './pages/formateur/GroupMembers';
import ArbitreAccueil from './pages/arbitre/Dashboard';
import QuizAttempt from './pages/arbitre/QuizAttempt';
import QuizAttemptResult from './pages/arbitre/QuizAttemptResult';
import Historique from './pages/arbitre/Historique';

function AccueilRedirect() {
  const { loading, session, roles } = useAuth();
  if (loading) return <p className="p-6 text-sm text-muted">Chargement…</p>;
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={roles[0] ? `/${roles[0]}` : '/login'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/qcm-arbitres">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/mot-de-passe-oublie" element={<MotDePasseOublie />} />
          <Route path="/activer-mon-compte" element={<ActiverCompte />} />
          <Route path="/confidentialite" element={<Confidentialite />} />
          <Route
            path="/mon-profil"
            element={
              <RequireAuth>
                <MonProfil />
              </RequireAuth>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute role="admin">
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/comptes"
            element={
              <ProtectedRoute role="admin">
                <Comptes />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/structures"
            element={
              <ProtectedRoute role="admin">
                <Structures />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/journal"
            element={
              <ProtectedRoute role="admin">
                <Journal />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/reglages"
            element={
              <ProtectedRoute role="admin">
                <Reglages />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/qcm/:id/resultats"
            element={
              <ProtectedRoute role="admin">
                <QuizResultats />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/qcm/:id/resultats/:attemptId"
            element={
              <ProtectedRoute role="admin">
                <AttemptDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/formateur"
            element={
              <ProtectedRoute role="formateur">
                <FormateurDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/formateur/qcm/nouveau"
            element={
              <ProtectedRoute role="formateur">
                <QuizForm />
              </ProtectedRoute>
            }
          />
          <Route
            path="/formateur/qcm/:id"
            element={
              <ProtectedRoute role="formateur">
                <QuizForm />
              </ProtectedRoute>
            }
          />
          <Route
            path="/formateur/qcm/:id/questions"
            element={
              <ProtectedRoute role="formateur">
                <QuizQuestions />
              </ProtectedRoute>
            }
          />
          <Route
            path="/formateur/qcm/:id/resultats"
            element={
              <ProtectedRoute role="formateur">
                <QuizResultats />
              </ProtectedRoute>
            }
          />
          <Route
            path="/formateur/qcm/:id/resultats/:attemptId"
            element={
              <ProtectedRoute role="formateur">
                <AttemptDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/formateur/groupes"
            element={
              <ProtectedRoute role="formateur">
                <Groupes />
              </ProtectedRoute>
            }
          />
          <Route
            path="/formateur/groupes/:id"
            element={
              <ProtectedRoute role="formateur">
                <GroupMembers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/arbitre"
            element={
              <ProtectedRoute role="arbitre">
                <ArbitreAccueil />
              </ProtectedRoute>
            }
          />
          <Route
            path="/arbitre/qcm/:id"
            element={
              <ProtectedRoute role="arbitre">
                <QuizAttempt />
              </ProtectedRoute>
            }
          />
          <Route
            path="/arbitre/qcm/:id/resultat/:attemptId"
            element={
              <ProtectedRoute role="arbitre">
                <QuizAttemptResult />
              </ProtectedRoute>
            }
          />
          <Route
            path="/arbitre/historique"
            element={
              <ProtectedRoute role="arbitre">
                <Historique />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<AccueilRedirect />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

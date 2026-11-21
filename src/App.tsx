import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { WizardWalletProvider } from './lib/wizardConnect';
import { BindPage } from './pages/BindPage';
import { RegistryPage } from './pages/RegistryPage';
import { VaultPage } from './pages/VaultPage';
import { VerifyPayPage } from './pages/VerifyPayPage';

export default function App() {
  return (
    <WizardWalletProvider>
      <AppShell>
        <Routes>
          <Route path="/" element={<RegistryPage />} />
          <Route path="/bind" element={<BindPage />} />
          <Route path="/verify" element={<VerifyPayPage />} />
          <Route path="/vault" element={<VaultPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </WizardWalletProvider>
  );
}

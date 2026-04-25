import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { Navbar } from "@/components/Navbar";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import UploadApi from "./pages/UploadApi";
import Scanner from "./pages/Scanner";
import Report from "./pages/Report";
import Dashboard from "./pages/Dashboard";
import About from "./pages/About";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      {/* Dev-only Supabase env warning banner */}
      {import.meta.env.DEV && (() => {
        const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
        const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
        const badUrl = !url || !/^https:\/\/.+\.supabase\.co\/?$/.test(url);
        const missingKey = !key || key.length < 10;
        if (badUrl || missingKey) {
          return (
            <div style={{background: '#fef3c7', color: '#92400e', padding: '8px 12px', textAlign: 'center'}}>
              <strong>Dev warning:</strong> Supabase env looks misconfigured.
              {badUrl && <span> Check <code>VITE_SUPABASE_URL</code>. </span>}
              {missingKey && <span> Missing or short <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>. </span>}
            </div>
          );
        }
        return null;
      })()}
      <BrowserRouter>
        <AuthProvider>
          <Navbar />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/upload" element={<ProtectedRoute><UploadApi /></ProtectedRoute>} />
            <Route path="/scanner" element={<ProtectedRoute><Scanner /></ProtectedRoute>} />
            <Route path="/report" element={<ProtectedRoute><Report /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

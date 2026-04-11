import { Link, useLocation, useNavigate } from "react-router-dom";
import { Shield, Menu, X, LogOut, User } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const navItems = [
  { label: "Home", path: "/" },
  { label: "Upload API", path: "/upload", auth: true },
  { label: "Scanner", path: "/scanner", auth: true },
  { label: "Report", path: "/report", auth: true },
  { label: "Dashboard", path: "/dashboard", auth: true },
  { label: "About", path: "/about" },
];

export function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  const visibleItems = navItems.filter((item) => !item.auth || user);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <Shield className="h-7 w-7 text-primary" />
          <span className="text-lg font-bold font-mono tracking-wider text-foreground">
            Auth<span className="text-primary">Guard</span>
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {visibleItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                location.pathname === item.path
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {item.label}
            </Link>
          ))}
          {user ? (
            <div className="flex items-center gap-2 ml-4">
              <span className="text-xs text-muted-foreground font-mono truncate max-w-[120px]">
                {user.email}
              </span>
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button asChild variant="outline" size="sm" className="ml-4 font-mono">
              <Link to="/auth">
                <User className="h-4 w-4 mr-1" /> Sign In
              </Link>
            </Button>
          )}
        </div>

        <button className="md:hidden text-foreground" onClick={() => setOpen(!open)}>
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="md:hidden border-t border-border bg-background overflow-hidden"
          >
            {visibleItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setOpen(false)}
                className={`block px-4 py-3 text-sm font-medium transition-colors ${
                  location.pathname === item.path
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            ))}
            {user ? (
              <button onClick={handleSignOut} className="block w-full text-left px-4 py-3 text-sm text-muted-foreground hover:text-foreground">
                Sign Out
              </button>
            ) : (
              <Link to="/auth" onClick={() => setOpen(false)} className="block px-4 py-3 text-sm text-primary font-medium">
                Sign In
              </Link>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

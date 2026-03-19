import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Layout } from "@/components/Layout";
import Dashboard from "@/pages/dashboard";
import Friends from "@/pages/friends";
import Groups from "@/pages/groups";
import GroupDetail from "@/pages/group-detail";
import FriendDetail from "@/pages/friend-detail";
import Expenses from "@/pages/expenses";
import Admin from "@/pages/admin";
import AuthPage from "@/pages/auth";
import NotFound from "@/pages/not-found";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, LogOut } from "lucide-react";

function PendingApproval() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-sm w-full p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
          <Clock className="w-7 h-7 text-amber-500" />
        </div>
        <h2 className="text-lg font-semibold mb-2">Account Pending Approval</h2>
        <p className="text-sm text-muted-foreground mb-1">
          Welcome, {user?.name}. Your account is waiting for the administrator to approve access.
        </p>
        <p className="text-xs text-muted-foreground mb-6">
          Please contact the admin to get your account approved.
        </p>
        <Button variant="outline" className="w-full" onClick={logout}>
          <LogOut className="w-4 h-4 mr-1.5" />
          Sign Out
        </Button>
      </Card>
    </div>
  );
}

function AppRouter() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <svg width="36" height="36" viewBox="0 0 32 32" fill="none" aria-label="Loading" className="animate-pulse">
            <rect width="32" height="32" rx="8" fill="hsl(172 63% 45%)" fillOpacity="0.15" />
            <path d="M10 11h12M10 16h12M10 21h12" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
            <path d="M16 8v16" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3" />
          </svg>
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  // Show pending state for non-approved, non-admin users
  if (!user.isApproved && !user.isAdmin) {
    return <PendingApproval />;
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/friends" component={Friends} />
        <Route path="/friends/:id">
          {(params) => <FriendDetail friendId={params.id} />}
        </Route>
        <Route path="/groups" component={Groups} />
        <Route path="/groups/:id">
          {(params) => <GroupDetail groupId={params.id} />}
        </Route>
        <Route path="/expenses" component={Expenses} />
        {user.isAdmin && <Route path="/admin" component={Admin} />}
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <AuthProvider>
            <Toaster />
            <Router hook={useHashLocation}>
              <AppRouter />
            </Router>
          </AuthProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

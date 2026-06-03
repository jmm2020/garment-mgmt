import { Navigate } from "react-router-dom";

/** Logged-in landing — redirects to the batch list. */
export function DashboardPage() {
  return <Navigate to="/batches" replace />;
}

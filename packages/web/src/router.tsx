import { Routes, Route } from "react-router-dom";
import { App } from "./App.js";
import { LoginPage } from "./pages/LoginPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { BatchesPage } from "./pages/BatchesPage.js";
import { BatchDetailPage } from "./pages/BatchDetailPage.js";
import { PvtPage } from "./pages/PvtPage.js";
import { PvtDetailPage } from "./pages/PvtDetailPage.js";

/**
 * Route tree. `/login` sits outside the authenticated shell so it renders
 * without the nav bar. All other routes nest under <App /> via <Outlet />.
 * Paths mirror the server prefixes in packages/server/src/app.ts.
 */
export function RouterComponent() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<App />}>
        <Route index element={<DashboardPage />} />
        <Route path="batches" element={<BatchesPage />} />
        <Route path="batches/:ref" element={<BatchDetailPage />} />
        <Route path="pvt" element={<PvtPage />} />
        <Route path="pvt/:runNo" element={<PvtDetailPage />} />
      </Route>
    </Routes>
  );
}

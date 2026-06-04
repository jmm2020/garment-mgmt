import { Link, Outlet, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { logout } from "./api/client.js";
import { ApiError } from "./api/types.js";
import { useEventStream } from "./hooks/useEventStream.js";

const navLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: "44px",
  padding: "0 16px",
  textDecoration: "none",
  color: "#1a1a1a",
  fontWeight: 600,
};

/** Authenticated shell: nav bar + logout + page outlet. Min-44px tap targets for floor tablets. */
export function App() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Open SSE stream for the lifetime of this authenticated shell.
  // Closes automatically when App unmounts (on logout or 401 redirect).
  useEventStream();

  async function handleLogout() {
    try {
      await logout();
    } catch (err) {
      // Any failure (API error, network down, proxy error) must not trap the user.
      if (!(err instanceof ApiError)) console.error("[logout] unexpected error:", err);
    }
    queryClient.clear();
    navigate("/login");
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", minHeight: "100vh" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          borderBottom: "1px solid #e0e0e0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <strong style={{ fontSize: "1.1rem" }}>Garment Mgmt</strong>
          <nav style={{ display: "flex" }}>
            <Link to="/" style={navLinkStyle}>
              Dashboard
            </Link>
            <Link to="/batches" style={navLinkStyle}>
              Batches
            </Link>
            <Link to="/pvt" style={navLinkStyle}>
              PVT
            </Link>
          </nav>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          style={{ minHeight: "44px", padding: "0 16px", cursor: "pointer" }}
        >
          Log out
        </button>
      </header>
      <main style={{ padding: "16px" }}>
        <Outlet />
      </main>
    </div>
  );
}

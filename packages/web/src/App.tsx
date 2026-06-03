import { Link, Outlet, useNavigate } from "react-router-dom";
import { post } from "./api/client.js";
import { ApiError } from "./api/types.js";

const navLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: "44px",
  padding: "0 16px",
  textDecoration: "none",
  color: "#1a1a1a",
  fontWeight: 600,
};

/**
 * Authenticated app shell: brand + nav + logout, with page content rendered
 * through <Outlet />. Large tap targets (min 44px) keep it floor-tablet friendly.
 */
export function App() {
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await post("/auth/logout");
    } catch (err) {
      // Logout failures should never trap the user — fall through to /login.
      if (!(err instanceof ApiError)) throw err;
    }
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

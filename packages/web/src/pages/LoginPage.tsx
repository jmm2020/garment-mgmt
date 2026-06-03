import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/client.js";
import { ApiError } from "../api/types.js";

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        throw err;
      }
    }
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 360, margin: "64px auto", padding: 16 }}>
      <h1>Garment Mgmt</h1>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            style={{ minHeight: 44, padding: "0 8px" }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            style={{ minHeight: 44, padding: "0 8px" }}
          />
        </label>
        <button type="submit" style={{ minHeight: 44, cursor: "pointer" }}>
          Log in
        </button>
        {error && <p style={{ color: "#b00020" }}>{error}</p>}
      </form>
    </div>
  );
}

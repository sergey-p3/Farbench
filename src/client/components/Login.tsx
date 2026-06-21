import { FormEvent, useState } from "react";
import { api } from "../api.js";

interface LoginProps {
  onLogin: () => void;
}

export function Login({ onLogin }: LoginProps) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await api.login(token);
      onLogin();
    } catch {
      setError("Invalid token");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <form className="login-panel" onSubmit={submit}>
        <h1>Remote Dev</h1>
        <label className="field">
          <span>Access token</span>
          <input
            autoComplete="current-password"
            autoFocus
            name="token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button type="submit" disabled={isSubmitting || token.trim().length === 0}>
          {isSubmitting ? "Connecting..." : "Connect"}
        </button>
      </form>
    </main>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/";
  const safeNext =
    nextPath.startsWith("/") && !nextPath.startsWith("//")
      ? nextPath
      : "/";

  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authConfigured, setAuthConfigured] = useState<boolean | null>(null);
  const [authDisabled, setAuthDisabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const statusRes = await fetch("/api/auth/status");
        const status = (await statusRes.json()) as {
          configured?: boolean;
          disabled?: boolean;
        };
        if (!cancelled) {
          setAuthConfigured(status.configured === true);
          setAuthDisabled(status.disabled === true);
        }
      } catch {
        if (!cancelled) setAuthConfigured(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/session");
        const data = (await res.json()) as {
          ok?: boolean;
          disabled?: boolean;
        };
        if (cancelled) return;
        if (data.ok && data.disabled) {
          router.replace(safeNext);
          return;
        }
        if (data.ok) {
          router.replace(safeNext);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, safeNext]);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setBusy(true);
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passphrase }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!res.ok) {
          const base = data.error ?? "Sign-in failed.";
          const hint =
            res.status === 401
              ? " Use the passphrase from this server’s LOGVIEW_AUTH_PASSPHRASES in .env (not examples in USAGE.md). Stay on the same host you opened in the browser (localhost vs 127.0.0.1)."
              : "";
          setError(`${base}${hint}`);
          return;
        }
        router.replace(safeNext);
        router.refresh();
      } catch {
        setError("Network error.");
      } finally {
        setBusy(false);
      }
    },
    [passphrase, router, safeNext],
  );

  return (
    <div className="login-gate">
      <h1 className="login-gate__title">Logview</h1>
      <p className="login-gate__lead">
        Enter a passphrase to open the viewer and API access for this deployment.
      </p>
      {authConfigured === false ? (
        <p className="login-gate__error" role="alert">
          Server auth is not configured. Set LOGVIEW_AUTH_SECRET (16+ characters) and
          LOGVIEW_AUTH_PASSPHRASES (JSON array) in .env, then restart the server. Or
          set LOGVIEW_AUTH_DISABLE=true for local development only.
        </p>
      ) : null}
      {authDisabled ? (
        <p className="login-gate__lead">Auth is disabled in development — redirecting…</p>
      ) : null}
      <form className="login-gate__form" onSubmit={onSubmit}>
        <label className="login-gate__label">
          <span className="login-gate__label-text">Passphrase</span>
          <input
            className="login-gate__input"
            type="password"
            name="passphrase"
            autoComplete="current-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            disabled={busy}
            required
          />
        </label>
        {error ? (
          <p className="login-gate__error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          className="login-gate__submit"
          disabled={busy}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

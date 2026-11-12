import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { AsciiArtAnimation } from "@/components/AsciiArtAnimation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Sparkles } from "lucide-react";

type AuthMode = "sign_in" | "sign_up";

export function AuthPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedMode = searchParams.get("mode") === "signup" ? "sign_up" : "sign_in";
  const [mode, setMode] = useState<AuthMode>(requestedMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorId = "auth-error";

  const nextPath = useMemo(() => searchParams.get("next") || "/app", [searchParams]);
  const isPortalContext =
    searchParams.get("context") === "portal" ||
    nextPath === "/portal" ||
    nextPath.startsWith("/portal/") ||
    nextPath === "/es/portal" ||
    nextPath.startsWith("/es/portal/");
  const { data: session, isLoading: isSessionLoading } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  useEffect(() => {
    if (session) {
      navigate(nextPath, { replace: true });
    }
  }, [session, navigate, nextPath]);

  useEffect(() => {
    setMode(requestedMode);
  }, [requestedMode]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "sign_up") {
        await authApi.signUpEmail({
          name: name.trim(),
          email: email.trim(),
          password,
        });
        return;
      }
      await authApi.signInEmail({ email: email.trim(), password });
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      navigate(nextPath, { replace: true });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Authentication failed");
    },
  });

  const canSubmit =
    email.trim().length > 0 &&
    password.trim().length > 0 &&
    (mode === "sign_in" || name.trim().length > 0);

  if (isSessionLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex bg-background">
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>
      {/* Left half — form */}
      <div className="w-full md:w-1/2 flex flex-col overflow-y-auto">
        <div className="w-full max-w-md mx-auto my-auto px-8 py-12">
          <div className="flex items-center gap-2 mb-8">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{isPortalContext ? "Ciutatis Portal" : "Ciutatis"}</span>
          </div>

          <div className="inline-flex rounded-md border border-border p-1">
            <button
              type="button"
              className={`rounded px-3 py-1.5 text-sm transition-colors ${
                mode === "sign_in"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => {
                setMode("sign_in");
                setError(null);
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1.5 text-sm transition-colors ${
                mode === "sign_up"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => {
                setMode("sign_up");
                setError(null);
              }}
            >
              Create account
            </button>
          </div>

          <h1 className="mt-6 text-xl font-semibold">
            {mode === "sign_up"
              ? isPortalContext
                ? "Create your citizen account"
                : "Create your Ciutatis account"
              : isPortalContext
                ? "Sign in to continue your public request"
                : "Sign in to Ciutatis"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "sign_up"
              ? isPortalContext
                ? "Use an email/password account to file requests and keep the conversation attached to your account."
                : "Create an email/password account to access this instance."
              : isPortalContext
                ? "Use your email and password to continue from the public civic portal."
                : "Use your email and password to access this instance."}
          </p>

          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (mutation.isPending) return;
              if (!canSubmit) {
                setError("Please fill in all required fields.");
                return;
              }
              mutation.mutate();
            }}
          >
            {mode === "sign_up" && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Name</label>
                <input
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                  aria-required="true"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  autoFocus
                />
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Email</label>
              <input
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                required
                aria-required="true"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                autoFocus={mode === "sign_in"}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Password</label>
              <input
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "sign_up" ? "new-password" : "current-password"}
              />
            </div>
            {error && (
              <p id={errorId} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={mutation.isPending}
              aria-disabled={!canSubmit || mutation.isPending}
              className={`w-full ${!canSubmit && !mutation.isPending ? "opacity-50" : ""}`}
            >
              {mutation.isPending ? "Working…" : mode === "sign_up" ? "Create account" : "Sign In"}
            </Button>
          </form>

        </div>
      </div>

      {/* Right half — ASCII art animation (hidden on mobile) */}
      <div className="hidden md:block w-1/2 overflow-hidden">
        <AsciiArtAnimation />
      </div>
    </div>
  );
}

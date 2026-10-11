import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Autentificare — TripSync" },
      { name: "description", content: "Intră în contul TripSync sau creează unul nou." },
      { property: "og:title", content: "Autentificare — TripSync" },
      { property: "og:description", content: "Intră în contul TripSync." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        nav({ to: "/dashboard" });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin + "/dashboard", data: { name } },
        });
        if (error) throw error;
        if (data.session) nav({ to: "/dashboard" });
        else setSent(true);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 shadow-soft">
        <Link to="/" className="font-display text-2xl font-extrabold text-primary">TripSync</Link>
        {sent ? (
          <p className="mt-6 text-sm">Ți-am trimis un e-mail de confirmare la <b>{email}</b>. Apasă pe link pentru a activa contul.</p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <h1 className="text-2xl font-bold">{mode === "in" ? "Bine ai revenit" : "Creează cont"}</h1>
            {mode === "up" && (
              <div className="space-y-1.5"><Label>Nume</Label><Input required value={name} onChange={(e) => setName(e.target.value)} /></div>
            )}
            <div className="space-y-1.5"><Label>E-mail</Label><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Parolă</Label><Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <Button className="w-full" disabled={busy}>{busy ? "Se încarcă…" : mode === "in" ? "Intră" : "Creează cont"}</Button>
            <button type="button" className="w-full text-sm text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === "in" ? "up" : "in")}>
              {mode === "in" ? "Nu ai cont? Înregistrează-te" : "Ai deja cont? Intră"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

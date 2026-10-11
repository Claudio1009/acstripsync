import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { statusLabel } from "@/lib/trip";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Călătoriile mele — TripSync" },
      { name: "description", content: "Toate călătoriile tale de grup într-un singur loc." },
      { property: "og:title", content: "Călătoriile mele — TripSync" },
      { property: "og:description", content: "Toate călătoriile tale de grup." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const trips = useQuery({
    queryKey: ["trips"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trips").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [days, setDays] = useState(3);
  const [code, setCode] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("trips")
      .insert({ name, start_date: start || null, days, organizer_id: u.user!.id }).select().single();
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["trips"] });
    nav({ to: "/trips/$id", params: { id: data.id } });
  }
  async function join(e: React.FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase.rpc("join_trip", { _code: code });
    if (error) return toast.error(error.message.includes("Cod") ? "Cod invalid" : error.message);
    qc.invalidateQueries({ queryKey: ["trips"] });
    nav({ to: "/trips/$id", params: { id: data as string } });
  }

  return (
    <div className="space-y-10">
      <div className="grid gap-4 md:grid-cols-2">
        <form onSubmit={create} className="space-y-3 rounded-2xl bg-hero p-6 text-primary-foreground shadow-soft">
          <h2 className="text-2xl font-bold">Călătorie nouă</h2>
          <Input required placeholder="Nume (ex. Vara în Grecia)" value={name} onChange={(e) => setName(e.target.value)} className="bg-card text-foreground" />
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Data de start</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="bg-card text-foreground" /></div>
            <div><Label className="text-xs">Număr zile</Label><Input type="number" min={1} max={30} value={days} onChange={(e) => setDays(+e.target.value)} className="bg-card text-foreground" /></div>
          </div>
          <Button variant="secondary" className="w-full">Creează</Button>
        </form>
        <form onSubmit={join} className="space-y-3 rounded-2xl border bg-card p-6">
          <h2 className="text-2xl font-bold">Ai un cod?</h2>
          <p className="text-sm text-muted-foreground">Intră în grupul prietenilor tăi.</p>
          <Input required placeholder="ABC123" value={code} onChange={(e) => setCode(e.target.value)} className="text-center font-mono text-lg uppercase tracking-widest" />
          <Button variant="outline" className="w-full">Intră în grup</Button>
        </form>
      </div>

      <section>
        <h2 className="mb-4 text-2xl font-bold">Călătoriile mele</h2>
        {trips.isLoading && <p className="text-muted-foreground">Se încarcă…</p>}
        {trips.error && <p className="text-destructive">Nu am putut încărca călătoriile.</p>}
        {trips.data?.length === 0 && <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">Nicio călătorie încă. Creează una mai sus.</p>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {trips.data?.map((t) => (
            <Link key={t.id} to="/trips/$id" params={{ id: t.id }} className="rounded-xl border bg-card p-5 transition hover:shadow-soft">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-lg font-bold">{t.name}</h3>
                <Badge variant="secondary">{statusLabel(t.status)}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{t.days} zile{t.start_date ? ` · din ${t.start_date}` : ""}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

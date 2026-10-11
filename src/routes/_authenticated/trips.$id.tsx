import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { generateActivities, generateDestinations } from "@/lib/ai.functions";
import { MAX_DAY_HOURS, statusLabel, type MemberScore } from "@/lib/trip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Check, Copy, Crown, Loader2, Sparkles, ThumbsUp, Trash2, ArrowUp, ArrowDown, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/trips/$id")({
  head: () => ({
    meta: [
      { title: "Călătorie — TripSync" },
      { name: "description", content: "Preferințe, destinații, vot și program pentru grupul tău." },
      { property: "og:title", content: "Călătorie — TripSync" },
      { property: "og:description", content: "Planificați călătoria împreună." },
    ],
  }),
  component: TripPage,
});

function useTripData(id: string) {
  return useQuery({
    queryKey: ["trip", id],
    queryFn: async () => {
      const [{ data: u }, trip, members, recs, votes, acts, items] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("trips").select("*").eq("id", id).single(),
        supabase.from("trip_members").select("*").eq("trip_id", id),
        supabase.from("recommendations").select("*").eq("trip_id", id).order("group_score", { ascending: false }),
        supabase.from("votes").select("*").eq("trip_id", id),
        supabase.from("activities").select("*").eq("trip_id", id).order("created_at"),
        supabase.from("itinerary_items").select("*").eq("trip_id", id).order("day").order("position"),
      ]);
      if (trip.error) throw trip.error;
      const ids = (members.data ?? []).map((m) => m.user_id);
      const { data: profiles } = await supabase.from("profiles").select("id,name").in("id", ids);
      return {
        me: u.user!.id,
        trip: trip.data,
        members: (members.data ?? []).map((m) => ({ ...m, name: profiles?.find((p) => p.id === m.user_id)?.name ?? "Membru" })),
        recs: recs.data ?? [],
        votes: votes.data ?? [],
        acts: acts.data ?? [],
        items: items.data ?? [],
      };
    },
  });
}
type Data = NonNullable<ReturnType<typeof useTripData>["data"]>;

function TripPage() {
  const { id } = Route.useParams();
  const q = useTripData(id);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["trip", id] });

  if (q.isLoading) return <p className="text-muted-foreground">Se încarcă…</p>;
  if (q.error || !q.data) return (
    <div className="text-center">
      <p className="text-destructive">Nu ai acces la această călătorie sau nu există.</p>
      <Button asChild variant="outline" className="mt-4"><Link to="/dashboard">Înapoi</Link></Button>
    </div>
  );
  const d = q.data;
  const isOrg = d.trip.organizer_id === d.me;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge variant="secondary">{statusLabel(d.trip.status)}</Badge>
          <h1 className="mt-2 text-4xl font-extrabold">{d.trip.name}</h1>
          <p className="text-muted-foreground">{d.trip.days} zile{d.trip.start_date ? ` · din ${d.trip.start_date}` : ""}</p>
        </div>
        <InviteBox code={d.trip.code} />
      </div>
      <Tabs defaultValue={d.trip.chosen_recommendation_id ? "activitati" : "grup"}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="grup">1 · Grup & preferințe</TabsTrigger>
          <TabsTrigger value="destinatii">2 · Destinații</TabsTrigger>
          <TabsTrigger value="activitati">3 · Activități</TabsTrigger>
          <TabsTrigger value="program">4 · Program</TabsTrigger>
        </TabsList>
        <TabsContent value="grup"><GroupTab d={d} refresh={refresh} /></TabsContent>
        <TabsContent value="destinatii"><DestTab d={d} isOrg={isOrg} refresh={refresh} /></TabsContent>
        <TabsContent value="activitati"><ActTab d={d} refresh={refresh} /></TabsContent>
        <TabsContent value="program"><PlanTab d={d} refresh={refresh} /></TabsContent>
      </Tabs>
    </div>
  );
}

function InviteBox({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-2">
      <div><p className="text-xs text-muted-foreground">Cod invitație</p><p className="font-mono text-xl font-bold tracking-widest">{code}</p></div>
      <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

const prefFields = [
  ["beach", "Plajă"], ["nature", "Natură"], ["culture", "Cultură"], ["fun", "Distracție"],
] as const;

function GroupTab({ d, refresh }: { d: Data; refresh: () => void }) {
  const mine = d.members.find((m) => m.user_id === d.me)!;
  const [budget, setBudget] = useState(mine.budget ?? 500);
  const [vals, setVals] = useState<Record<string, number>>({
    beach: mine.beach ?? 3, nature: mine.nature ?? 3, culture: mine.culture ?? 3, fun: mine.fun ?? 3,
  });
  const [pace, setPace] = useState(mine.pace ?? "moderat");
  const voted = new Set(d.votes.filter((v) => v.target_type === "destination").map((v) => v.user_id));

  async function save() {
    const { error } = await supabase.from("trip_members").update({ budget, ...vals, pace, prefs_complete: true })
      .eq("trip_id", d.trip.id).eq("user_id", d.me);
    if (error) return toast.error(error.message);
    toast.success("Preferințe salvate");
    refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5 rounded-2xl border bg-card p-6">
        <h2 className="text-xl font-bold">Preferințele mele</h2>
        <div className="space-y-1.5">
          <Label>Buget / persoană (EUR)</Label>
          <Input type="number" min={50} step={50} value={budget} onChange={(e) => setBudget(+e.target.value)} />
        </div>
        {prefFields.map(([k, label]) => (
          <div key={k} className="space-y-2">
            <div className="flex justify-between text-sm"><Label>{label}</Label><span className="font-semibold">{vals[k]}/5</span></div>
            <Slider min={1} max={5} step={1} value={[vals[k]]} onValueChange={([v]) => setVals({ ...vals, [k]: v })} />
          </div>
        ))}
        <div className="space-y-2">
          <Label>Ritm</Label>
          <div className="flex gap-2">
            {["relaxat", "moderat", "intens"].map((p) => (
              <Button key={p} type="button" size="sm" variant={pace === p ? "default" : "outline"} onClick={() => setPace(p)} className="capitalize">{p}</Button>
            ))}
          </div>
        </div>
        <Button onClick={save}>{mine.prefs_complete ? "Actualizează" : "Salvează preferințele"}</Button>
      </div>
      <div className="rounded-2xl border bg-card p-6">
        <h2 className="text-xl font-bold">Membri ({d.members.length})</h2>
        <ul className="mt-4 space-y-3">
          {d.members.map((m) => (
            <li key={m.user_id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                {m.role === "organizator" && <Crown className="h-3.5 w-3.5 text-primary" />}{m.name}{m.user_id === d.me && " (tu)"}
              </span>
              <span className="flex gap-1">
                <Badge variant={m.prefs_complete ? "default" : "outline"}>{m.prefs_complete ? "Preferințe ✓" : "Preferințe…"}</Badge>
                {voted.has(m.user_id) && <Badge variant="secondary">A votat</Badge>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DestTab({ d, isOrg, refresh }: { d: Data; isOrg: boolean; refresh: () => void }) {
  const gen = useServerFn(generateDestinations);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const destVotes = d.votes.filter((v) => v.target_type === "destination");
  const myVote = destVotes.find((v) => v.user_id === d.me)?.target_id;
  const count = (rid: string) => destVotes.filter((v) => v.target_id === rid).length;
  const ready = d.members.filter((m) => m.prefs_complete).length;

  async function run() {
    setBusy(true); setErr(null);
    try { await gen({ data: { tripId: d.trip.id } }); refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  async function vote(rid: string) {
    if (myVote) await supabase.from("votes").delete().eq("trip_id", d.trip.id).eq("user_id", d.me).eq("target_type", "destination");
    if (myVote !== rid) {
      const { error } = await supabase.from("votes").insert({ trip_id: d.trip.id, user_id: d.me, target_type: "destination", target_id: rid });
      if (error) toast.error(error.message);
    }
    refresh();
  }
  async function confirm(rid: string) {
    const { error } = await supabase.from("trips").update({ chosen_recommendation_id: rid, status: "finalizata" }).eq("id", d.trip.id);
    if (error) return toast.error(error.message);
    toast.success("Destinație confirmată!"); refresh();
  }
  // tie-break: votes, then group score
  const leader = [...d.recs].sort((a, b) => count(b.id) - count(a.id) || (b.group_score ?? 0) - (a.group_score ?? 0))[0];
  const cmp = d.recs.filter((r) => compare.includes(r.id));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-5">
        <p className="text-sm text-muted-foreground">{ready}/{d.members.length} membri și-au completat preferințele.</p>
        <Button onClick={run} disabled={busy || ready === 0}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? "AI-ul caută destinații…" : d.recs.length ? "Generează alte propuneri" : "Recomandă destinații"}
        </Button>
      </div>
      {err && (
        <div className="flex items-center justify-between rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {err}<Button size="sm" variant="outline" onClick={run}><RefreshCw className="h-4 w-4" />Reîncearcă</Button>
        </div>
      )}
      {!d.recs.length && !busy && <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">Încă nu există recomandări.</p>}
      {cmp.length >= 2 && (
        <div className="overflow-x-auto rounded-2xl border bg-card p-5">
          <h3 className="mb-3 font-bold">Comparație</h3>
          <table className="w-full text-sm">
            <thead><tr><th className="text-left" />{cmp.map((r) => <th key={r.id} className="text-left">{r.name}</th>)}</tr></thead>
            <tbody>
              <tr><td className="py-1 text-muted-foreground">Scor grup</td>{cmp.map((r) => <td key={r.id}>{r.group_score}</td>)}</tr>
              <tr><td className="py-1 text-muted-foreground">Cost / pers.</td>{cmp.map((r) => <td key={r.id}>{r.cost_estimate} €</td>)}</tr>
              <tr><td className="py-1 text-muted-foreground">Voturi</td>{cmp.map((r) => <td key={r.id}>{count(r.id)}</td>)}</tr>
              {d.members.map((m) => (
                <tr key={m.user_id}><td className="py-1 text-muted-foreground">{m.name}</td>
                  {cmp.map((r) => <td key={r.id}>{(r.member_scores as MemberScore[]).find((s) => s.user_id === m.user_id)?.score ?? "–"}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {d.recs.map((r) => {
          const chosen = d.trip.chosen_recommendation_id === r.id;
          return (
            <div key={r.id} className={`rounded-2xl border bg-card p-5 ${chosen ? "ring-2 ring-primary" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold">{r.name}</h3>
                  <p className="text-sm text-muted-foreground">{r.country} · ~{r.cost_estimate} € / pers.</p>
                </div>
                <div className="text-right"><p className="font-display text-3xl font-extrabold text-primary">{r.group_score}</p><p className="text-xs text-muted-foreground">scor grup</p></div>
              </div>
              <p className="mt-3 text-sm">{r.description}</p>
              <p className="mt-2 rounded-lg bg-muted p-3 text-sm"><b>De ce:</b> {r.explanation}</p>
              <div className="mt-4 space-y-2">
                {(r.member_scores as MemberScore[]).map((s) => (
                  <div key={s.user_id} className="grid grid-cols-[100px_1fr_32px] items-center gap-2 text-xs">
                    <span className="truncate">{s.name}</span><Progress value={s.score} /><span className="text-right font-semibold">{s.score}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button size="sm" variant={myVote === r.id ? "default" : "outline"} onClick={() => vote(r.id)}>
                  <ThumbsUp className="h-4 w-4" />{myVote === r.id ? "Votat" : "Votează"} · {count(r.id)}
                </Button>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input type="checkbox" checked={compare.includes(r.id)} onChange={(e) => setCompare(e.target.checked ? [...compare, r.id] : compare.filter((x) => x !== r.id))} />Compară
                </label>
                {isOrg && !chosen && (
                  <Button size="sm" variant="secondary" className="ml-auto" onClick={() => confirm(r.id)}>
                    {leader?.id === r.id ? "Confirmă (lider)" : "Confirmă"}
                  </Button>
                )}
                {chosen && <Badge className="ml-auto">Destinația aleasă</Badge>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActTab({ d, refresh }: { d: Data; refresh: () => void }) {
  const gen = useServerFn(generateActivities);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [maxCost, setMaxCost] = useState<number | "">("");
  const [maxDur, setMaxDur] = useState<number | "">("");
  const [day, setDay] = useState(1);
  const dest = d.recs.find((r) => r.id === d.trip.chosen_recommendation_id);
  const actVotes = d.votes.filter((v) => v.target_type === "activity");
  const planned = new Set(d.items.map((i) => i.activity_id));

  const list = useMemo(() => d.acts
    .filter((a) => maxCost === "" || (a.cost ?? 0) <= maxCost)
    .filter((a) => maxDur === "" || Number(a.duration_hours) <= maxDur)
    .sort((a, b) => actVotes.filter((v) => v.target_id === b.id).length - actVotes.filter((v) => v.target_id === a.id).length),
  [d.acts, maxCost, maxDur, actVotes]);

  if (!dest) return <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">Mai întâi organizatorul trebuie să confirme o destinație.</p>;

  async function run() {
    setBusy(true); setErr(null);
    try { await gen({ data: { tripId: d.trip.id } }); refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  async function toggleVote(aid: string) {
    const mine = actVotes.find((v) => v.target_id === aid && v.user_id === d.me);
    if (mine) await supabase.from("votes").delete().match({ trip_id: d.trip.id, user_id: d.me, target_type: "activity", target_id: aid });
    else await supabase.from("votes").insert({ trip_id: d.trip.id, user_id: d.me, target_type: "activity", target_id: aid });
    refresh();
  }
  async function add(aid: string) {
    const a = d.acts.find((x) => x.id === aid)!;
    const used = d.items.filter((i) => i.day === day).reduce((s, i) => s + Number(d.acts.find((x) => x.id === i.activity_id)?.duration_hours ?? 0), 0);
    if (used + Number(a.duration_hours) > MAX_DAY_HOURS) return toast.error(`Ziua ${day} depășește ${MAX_DAY_HOURS} ore.`);
    const { error } = await supabase.from("itinerary_items").insert({ trip_id: d.trip.id, activity_id: aid, day, position: d.items.filter((i) => i.day === day).length });
    if (error) return toast.error(error.message);
    toast.success(`Adăugat în ziua ${day}`); refresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-5">
        <div className="mr-auto"><p className="text-xs text-muted-foreground">Destinație</p><p className="text-xl font-bold">{dest.name}, {dest.country}</p></div>
        <div><Label className="text-xs">Cost max (€)</Label><Input className="w-28" type="number" value={maxCost} onChange={(e) => setMaxCost(e.target.value === "" ? "" : +e.target.value)} /></div>
        <div><Label className="text-xs">Durată max (h)</Label><Input className="w-28" type="number" value={maxDur} onChange={(e) => setMaxDur(e.target.value === "" ? "" : +e.target.value)} /></div>
        <div><Label className="text-xs">Adaugă în ziua</Label>
          <select className="h-9 rounded-md border bg-background px-2" value={day} onChange={(e) => setDay(+e.target.value)}>
            {Array.from({ length: d.trip.days }, (_, i) => <option key={i} value={i + 1}>Ziua {i + 1}</option>)}
          </select>
        </div>
        <Button onClick={run} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{d.acts.length ? "Mai multe activități" : "Recomandă activități"}</Button>
      </div>
      {err && (
        <div className="flex items-center justify-between rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {err}<Button size="sm" variant="outline" onClick={run}><RefreshCw className="h-4 w-4" />Reîncearcă</Button>
        </div>
      )}
      {!list.length && !busy && <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">{d.acts.length ? "Nicio activitate nu se potrivește filtrelor." : "Încă nu există activități."}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((a) => {
          const n = actVotes.filter((v) => v.target_id === a.id).length;
          const mine = actVotes.some((v) => v.target_id === a.id && v.user_id === d.me);
          return (
            <div key={a.id} className="flex flex-col rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2"><h3 className="font-bold">{a.name}</h3>{a.category && <Badge variant="outline">{a.category}</Badge>}</div>
              <p className="mt-1 flex-1 text-sm text-muted-foreground">{a.description}</p>
              <p className="mt-2 text-sm font-medium">{a.cost} € · {Number(a.duration_hours)} h</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant={mine ? "default" : "outline"} onClick={() => toggleVote(a.id)}><ThumbsUp className="h-4 w-4" />{n}</Button>
                <Button size="sm" variant="secondary" disabled={planned.has(a.id)} onClick={() => add(a.id)}>{planned.has(a.id) ? "În program" : "Adaugă"}</Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlanTab({ d, refresh }: { d: Data; refresh: () => void }) {
  const act = (id: string) => d.acts.find((a) => a.id === id);
  const total = d.items.reduce((s, i) => s + (act(i.activity_id)?.cost ?? 0), 0);
  const [, force] = useState(0);
  useEffect(() => force((x) => x + 1), [d.items]);

  async function move(itemId: string, dayDelta: number, posDelta: number) {
    const it = d.items.find((i) => i.id === itemId)!;
    const nd = Math.min(Math.max(it.day + dayDelta, 1), d.trip.days);
    await supabase.from("itinerary_items").update({ day: nd, position: it.position + posDelta * 1.5 }).eq("id", itemId);
    refresh();
  }
  async function remove(itemId: string) {
    await supabase.from("itinerary_items").delete().eq("id", itemId);
    refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-6 rounded-2xl bg-hero p-5 text-primary-foreground">
        <div><p className="text-xs opacity-80">Activități</p><p className="font-display text-3xl font-extrabold">{d.items.length}</p></div>
        <div><p className="text-xs opacity-80">Cost total / pers.</p><p className="font-display text-3xl font-extrabold">{total} €</p></div>
        <Button variant="secondary" className="ml-auto self-center" onClick={() => window.print()}>Exportă / Printează</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: d.trip.days }, (_, i) => i + 1).map((day) => {
          const its = d.items.filter((x) => x.day === day).sort((a, b) => a.position - b.position);
          const hours = its.reduce((s, x) => s + Number(act(x.activity_id)?.duration_hours ?? 0), 0);
          return (
            <div key={day} className="rounded-2xl border bg-card p-4">
              <div className="flex items-center justify-between"><h3 className="text-lg font-bold">Ziua {day}</h3>
                <span className={`text-xs font-semibold ${hours > MAX_DAY_HOURS ? "text-destructive" : "text-muted-foreground"}`}>{hours} / {MAX_DAY_HOURS} h</span></div>
              {!its.length && <p className="mt-3 text-sm text-muted-foreground">Nimic planificat.</p>}
              <ul className="mt-3 space-y-2">
                {its.map((x) => {
                  const a = act(x.activity_id);
                  return (
                    <li key={x.id} className="rounded-lg bg-muted p-2 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium">{a?.name}</span>
                        <span className="whitespace-nowrap text-xs text-muted-foreground">{Number(a?.duration_hours)}h · {a?.cost}€</span>
                      </div>
                      <div className="mt-1 flex gap-1 print:hidden">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(x.id, 0, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(x.id, 0, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={day === 1} onClick={() => move(x.id, -1, 0)}>← zi</Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={day === d.trip.days} onClick={() => move(x.id, 1, 0)}>zi →</Button>
                        <Button size="icon" variant="ghost" className="ml-auto h-7 w-7" onClick={() => remove(x.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

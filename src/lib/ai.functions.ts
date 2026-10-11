import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function callAI(prompt: string) {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("Serviciul AI nu este configurat.");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Ești un planificator de călătorii de grup. Răspunzi DOAR cu JSON valid, în limba română. Costurile sunt în EUR." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (res.status === 429) throw new Error("Prea multe cereri către AI. Reîncearcă peste puțin timp.");
  if (res.status === 402) throw new Error("Creditele AI s-au epuizat.");
  if (!res.ok) throw new Error(`AI indisponibil (${res.status}). Reîncearcă.`);
  const j = (await res.json()) as { choices: { message: { content: string } }[] };
  const txt = j.choices[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(txt.replace(/^```json\s*|```$/g, ""));
  } catch {
    throw new Error("Răspuns AI invalid. Reîncearcă.");
  }
}

async function loadMembers(supabase: any, tripId: string) {
  const { data: members, error } = await supabase.from("trip_members").select("*").eq("trip_id", tripId);
  if (error || !members?.length) throw new Error("Nu ai acces la această călătorie.");
  const { data: profiles } = await supabase.from("profiles").select("id,name").in("id", members.map((m: any) => m.user_id));
  return members.map((m: any) => ({ ...m, name: profiles?.find((p: any) => p.id === m.user_id)?.name ?? "Membru" }));
}

export const generateDestinations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { tripId: string }) => i)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: trip } = await sb.from("trips").select("*").eq("id", data.tripId).single();
    if (!trip) throw new Error("Călătorie inexistentă.");
    const members = (await loadMembers(sb, data.tripId)).filter((m: any) => m.prefs_complete);
    if (!members.length) throw new Error("Niciun membru nu și-a completat preferințele.");
    const prefs = members.map((m: any) => ({
      user_id: m.user_id, nume: m.name, buget_eur_persoana: m.budget,
      plaja: m.beach, natura: m.nature, cultura: m.culture, distractie: m.fun, ritm: m.pace,
    }));
    const out = await callAI(
      `Grup pentru o călătorie de ${trip.days} zile${trip.start_date ? ` începând cu ${trip.start_date}` : ""} (plecare din România). Preferințe (scara 1-5):\n${JSON.stringify(prefs)}\n` +
      `Propune 4 destinații care sunt cel mai bun compromis pentru grup. Returnează {"destinations":[{"name","country","cost_estimate" (EUR/persoană, întreg),"description" (1 frază),"group_score" (0-100),"member_scores":[{"user_id","score" (0-100)}],"explanation" (2 fraze: de ce și ce compromis)}]}. Include un scor pentru fiecare user_id.`,
    );
    const rows = (out.destinations ?? []).slice(0, 6).map((d: any) => ({
      trip_id: data.tripId, name: String(d.name), country: d.country ?? null,
      cost_estimate: Math.round(Number(d.cost_estimate) || 0), description: d.description ?? null,
      group_score: Math.round(Number(d.group_score) || 0),
      member_scores: members.map((m: any) => ({
        user_id: m.user_id, name: m.name,
        score: Math.round(Number(d.member_scores?.find((s: any) => s.user_id === m.user_id)?.score) || 0),
      })),
      explanation: d.explanation ?? null,
    }));
    if (!rows.length) throw new Error("AI-ul nu a returnat destinații. Reîncearcă.");
    const { error } = await sb.from("recommendations").insert(rows);
    if (error) throw new Error(error.message);
    if (trip.status === "organizare" && trip.organizer_id === context.userId) {
      await sb.from("trips").update({ status: "votare" }).eq("id", data.tripId);
    }
    return { count: rows.length };
  });

export const generateActivities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { tripId: string }) => i)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: trip } = await sb.from("trips").select("*").eq("id", data.tripId).single();
    if (!trip?.chosen_recommendation_id) throw new Error("Destinația nu a fost confirmată.");
    const { data: dest } = await sb.from("recommendations").select("*").eq("id", trip.chosen_recommendation_id).single();
    const members = (await loadMembers(sb, data.tripId)).filter((m: any) => m.prefs_complete);
    const out = await callAI(
      `Destinație: ${dest?.name}, ${dest?.country}. ${trip.days} zile. Preferințe grup: ${JSON.stringify(members.map((m: any) => ({ buget: m.budget, plaja: m.beach, natura: m.nature, cultura: m.culture, distractie: m.fun, ritm: m.pace })))}.\n` +
      `Propune ${Math.min(trip.days * 3 + 3, 24)} activități variate. Returnează {"activities":[{"name","category" (plajă|natură|cultură|distracție|gastronomie),"cost" (EUR/persoană, întreg),"duration_hours" (număr),"description" (1 frază)}]}.`,
    );
    const rows = (out.activities ?? []).map((a: any) => ({
      trip_id: data.tripId, name: String(a.name), category: a.category ?? null,
      cost: Math.round(Number(a.cost) || 0), duration_hours: Number(a.duration_hours) || 2, description: a.description ?? null,
    }));
    if (!rows.length) throw new Error("AI-ul nu a returnat activități. Reîncearcă.");
    const { error } = await sb.from("activities").insert(rows);
    if (error) throw new Error(error.message);
    return { count: rows.length };
  });

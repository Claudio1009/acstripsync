import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Users, Sparkles, Vote, CalendarDays } from "lucide-react";
import hero from "@/assets/hero.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TripSync — Călătorii de grup, fără haos" },
      { name: "description", content: "Fiecare își spune preferințele, AI-ul propune destinații, grupul votează, iar voi primiți programul pe zile." },
      { property: "og:title", content: "TripSync — Călătorii de grup, fără haos" },
      { property: "og:description", content: "Preferințe individuale, recomandări AI, vot și program pe zile." },
    ],
  }),
  component: Index,
});

const steps = [
  { icon: Users, t: "Creezi grupul", d: "Trimiți codul prietenilor." },
  { icon: Sparkles, t: "AI propune", d: "Destinații cu scor pentru fiecare membru." },
  { icon: Vote, t: "Votați", d: "Organizatorul confirmă alegerea." },
  { icon: CalendarDays, t: "Program pe zile", d: "Activități, durată și cost total." },
];

function Index() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="font-display text-2xl font-extrabold text-primary">TripSync</span>
        <Button asChild variant="ghost"><Link to="/auth">Intră în cont</Link></Button>
      </header>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-10 md:grid-cols-2">
        <div>
          <h1 className="text-5xl font-extrabold leading-[1.05] md:text-6xl">
            Plecați împreună.<br /><span className="text-primary">Decideți ușor.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg text-muted-foreground">
            Fiecare își completează preferințele și bugetul. TripSync găsește compromisul pentru tot grupul.
          </p>
          <div className="mt-8 flex gap-3">
            <Button asChild size="lg"><Link to="/dashboard">Începe o călătorie</Link></Button>
            <Button asChild size="lg" variant="outline"><Link to="/dashboard">Am un cod</Link></Button>
          </div>
        </div>
        <img src={hero} alt="Prieteni pe o terasă cu vedere la mare" width={1280} height={960} className="aspect-[4/3] w-full rounded-2xl object-cover shadow-soft" />
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-20 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <div key={s.t} className="rounded-xl border bg-card p-5">
            <s.icon className="h-6 w-6 text-primary" />
            <p className="mt-3 text-xs font-semibold text-muted-foreground">PASUL {i + 1}</p>
            <h3 className="text-lg font-bold">{s.t}</h3>
            <p className="text-sm text-muted-foreground">{s.d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

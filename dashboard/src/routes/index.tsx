import { createFileRoute } from "@tanstack/react-router";
import { HealingDashboard } from "@/components/HealingDashboard";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "SHAPI — Outcome Protection" },
    { name: "description", content: "Protect connected services by monitoring business outcomes and reviewing safe repairs." },
    { property: "og:title", content: "SHAPI — Outcome Protection" },
    { property: "og:description", content: "Monitor business outcomes, review drift, and verify safe repairs." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Index,
});

function Index() {
  return <HealingDashboard />;
}

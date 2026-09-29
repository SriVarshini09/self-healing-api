import { createFileRoute } from "@tanstack/react-router";
import { HealingDashboard } from "@/components/HealingDashboard";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Pulseguard — Self-Healing API Control Plane" },
    { name: "description", content: "An animated operational dashboard preview for monitoring and healing API services." },
    { property: "og:title", content: "Pulseguard — Self-Healing API Control Plane" },
    { property: "og:description", content: "Explore an animated preview of API health, interventions, and global traffic." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Index,
});

function Index() {
  return <HealingDashboard />;
}

import { createFileRoute } from "@tanstack/react-router";
import { Console } from "@/components/console/Console";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "SHAPI — Stripe says paid. Did the customer get access?" },
    { name: "description", content: "SHAPI checks your own database after every Stripe payment and tells you, by customer, when someone paid but was not provisioned." },
    { property: "og:title", content: "SHAPI — Stripe says paid. Did the customer get access?" },
    { property: "og:description", content: "Catch paid-but-not-provisioned customers before they email you. Read-only checks against your Postgres, alerts by customer." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Index,
});

function Index() {
  return <Console />;
}

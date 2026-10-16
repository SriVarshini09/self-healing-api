-- SDK event ids are chosen by each workspace, so uniqueness is per workspace.
-- Before this, two workspaces using the same id collided: the second workspace got
-- success back but its event was never stored.
DROP INDEX "TrackedEvent_eventId_key";

CREATE UNIQUE INDEX "TrackedEvent_tenantId_eventId_key" ON "TrackedEvent"("tenantId", "eventId");

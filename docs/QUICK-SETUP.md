# SHAPI in 15 minutes: check that every Stripe payment unlocked the account

You'll set up one **outcome check**. After each Stripe payment, SHAPI asks your
database "did this customer actually get access?" When the answer is no, you
get an incident with the customer and the Stripe event.

SHAPI never writes to your database and never needs code changes in your app.

## What you need

- A running SHAPI and an API key (or SSO access to its dashboard).
- Read access to your production Postgres. You'll create a read-only user below.
- Your Stripe Dashboard.

## 0. Create your workspace (1 min)

Open the SHAPI dashboard and choose **Create workspace**. During the beta you
need an invite code. You land on the Overview, where a **Get started**
checklist tracks the steps below. To add Stripe, use **Connections → Add
connection**. For API keys (scripts, CI, the SDK), use **Settings**.

## 1. Create a read-only database user (3 min)

Run this as an admin. Grant `SELECT` only on the tables your check reads.

```sql
CREATE ROLE shapi_readonly LOGIN PASSWORD 'choose-a-long-random-password';
GRANT CONNECT ON DATABASE your_app TO shapi_readonly;
GRANT USAGE ON SCHEMA public TO shapi_readonly;
GRANT SELECT ON public.users TO shapi_readonly;   -- the table(s) your check reads
ALTER ROLE shapi_readonly SET default_transaction_read_only = on;
```

Your connection string will look like
`postgresql://shapi_readonly:...@your-db-host:5432/your_app`.

SHAPI also runs every query in a read-only transaction with a 5-second timeout,
and only checks whether a row exists. The read-only user is a second safety layer.

## 2. Create a Stripe restricted key (2 min, optional)

With a key, SHAPI pulls payment events from Stripe itself every 15 minutes, so
you don't have to change any webhook settings.

1. Stripe Dashboard → **Developers → API keys → Create restricted key**.
2. Give it **Read** access to **Events**. Leave everything else at **None**.
3. Copy the `rk_live_…` key.

Secret keys (`sk_live_…`) are refused; SHAPI only needs to read events.

## 3. Write the query that means "provisioned" (5 min)

Use `:name` for values taken from the Stripe event. Some common schemas:

**Users table with a plan status**, after `invoice.payment_succeeded`:

```sql
SELECT 1 FROM users
WHERE stripe_customer_id = :customer AND plan_status = 'active'
```

Parameter: `customer` → `data.object.customer`

**Vercel `saas-starter` (teams table)**, after `customer.subscription.updated`:

```sql
SELECT 1 FROM teams
WHERE stripe_customer_id = :customer
  AND stripe_subscription_id = :subscription
  AND subscription_status = :status
```

Parameters: `customer` → `data.object.customer`, `subscription` → `data.object.id`,
`status` → `data.object.status`

**A subscriptions table**, after `checkout.session.completed`:

```sql
SELECT 1 FROM subscriptions
WHERE stripe_subscription_id = :subscription AND status IN ('active', 'trialing')
```

Parameter: `subscription` → `data.object.subscription`

Pick a deadline that covers your normal provisioning time. Five minutes
(300 seconds) is a good default.

## 4. Create the check (2 min)

Dashboard → **Outcome checks → New check**. Fill in:

- the Stripe event,
- the deadline,
- the query,
- the database URL,
- optionally, the restricted key.

The form detects each `:name` placeholder and suggests where it comes from in the event.

## 5. Test it with a real event (2 min)

Stripe Dashboard → **Developers → Events** → open a recent payment event →
copy its JSON. In SHAPI, click **Test** on your check and paste the event.
"Found" means the query matches your schema. If you added a Stripe key, press
**Check last 24h** to check yesterday's payments right away.

## 6. Optional: real-time webhooks

To catch problems in minutes rather than up to 15, add a Stripe webhook
endpoint pointing at SHAPI. Copy the exact URL from **Connections → Setup**.

To send incidents to Slack or your pager, set `ALERT_WEBHOOK_URL` on the API.

## Turning it off

Pause or delete the check in the dashboard, revoke the Stripe key, and drop
the role:

```sql
DROP ROLE shapi_readonly;
```

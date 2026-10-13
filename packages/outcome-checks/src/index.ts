// @shapi/outcome-checks - verify a business outcome exists in the customer's database
// after a provider event (e.g. Stripe invoice.payment_succeeded => an active
// subscription row), without any SDK instrumentation in the customer's code.
export * from './sql.js';
export * from './bind.js';
export * from './runner.js';

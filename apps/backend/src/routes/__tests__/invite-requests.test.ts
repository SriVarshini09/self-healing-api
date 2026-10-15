import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  config: { SHAPI_OPERATOR_EMAIL: undefined as string | undefined },
  emailOn: false,
  upserts: [] as Array<Record<string, unknown>>,
  sent: [] as Array<{ to: string[]; subject: string; text: string }>,
  requests: 1,
}));

vi.mock('../../config.js', () => ({ config: state.config }));
vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    inviteRequest: {
      upsert: async (args: Record<string, unknown>) => {
        state.upserts.push(args);
        return { requests: state.requests };
      },
    },
  },
}));
vi.mock('../../services/email.js', () => ({
  emailAvailable: () => state.emailOn,
  sendEmail: async (message: { to: string[]; subject: string; text: string }) => { state.sent.push(message); },
}));

const { inviteRequestRoutes } = await import('../invite-requests.js');

async function submit(payload: unknown) {
  const app = Fastify();
  await app.register(inviteRequestRoutes, { prefix: '/api/v1' });
  const response = await app.inject({ method: 'POST', url: '/api/v1/invite-requests', payload: payload as Record<string, unknown> });
  await new Promise(resolve => setTimeout(resolve, 10)); // notification is fire-and-forget
  await app.close();
  return { status: response.statusCode, body: JSON.parse(response.body) };
}

beforeEach(() => {
  state.config.SHAPI_OPERATOR_EMAIL = undefined;
  state.emailOn = false;
  state.upserts = [];
  state.sent = [];
  state.requests = 1;
});

describe('POST /invite-requests', () => {
  it('stores a request under the normalized email and answers 202', async () => {
    const result = await submit({ email: '  Founder@Acme.COM ', name: 'Ada', company: 'Acme', note: 'Stripe + Supabase' });
    expect(result).toEqual({ status: 202, body: { ok: true } });
    expect(state.upserts).toEqual([{
      where: { email: 'founder@acme.com' },
      create: { email: 'founder@acme.com', name: 'Ada', company: 'Acme', note: 'Stripe + Supabase' },
      update: { name: 'Ada', company: 'Acme', note: 'Stripe + Supabase', requests: { increment: 1 } },
    }]);
  });

  it('keeps earlier answers when a repeat request leaves fields blank', async () => {
    await submit({ email: 'founder@acme.com', name: '', company: '   ' });
    expect(state.upserts[0].update).toEqual({ name: undefined, company: undefined, note: undefined, requests: { increment: 1 } });
  });

  it('refuses a bad email or oversized answers, and unknown fields', async () => {
    expect((await submit({ email: 'nope' })).body.error).toBe('Enter a valid work email');
    expect((await submit({ email: 'a@b.co', note: 'x'.repeat(1001) })).body.error).toBe('Please shorten your answers');
    expect((await submit({ email: 'a@b.co', role: 'admin' })).status).toBe(400);
    expect(state.upserts).toEqual([]);
  });

  it('silently drops honeypot (bot) submissions', async () => {
    const result = await submit({ email: 'bot@spam.example', website: 'http://spam.example' });
    expect(result).toEqual({ status: 202, body: { ok: true } });
    expect(state.upserts).toEqual([]);
  });

  it('emails the operator only when an operator address and email are configured', async () => {
    await submit({ email: 'founder@acme.com', company: 'Acme' });
    expect(state.sent).toEqual([]);
    state.config.SHAPI_OPERATOR_EMAIL = 'me@shapi.dev';
    state.emailOn = true;
    await submit({ email: 'founder@acme.com', company: 'Acme <b>' });
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].to).toEqual(['me@shapi.dev']);
    expect(state.sent[0].subject).toBe('New SHAPI invite request: Acme <b>');
    state.requests = 2;
    await submit({ email: 'founder@acme.com' });
    expect(state.sent[1].subject).toBe('Repeat SHAPI invite request: founder@acme.com');
  });
});

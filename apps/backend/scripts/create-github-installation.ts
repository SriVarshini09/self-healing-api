import { prisma } from '../src/utils/prisma.js';

const accountLogin = process.argv[2] || 'SriVarshini09';
const repository = process.argv[3] || 'SriVarshini09/self-healing-api';

async function main() {
  const integration = await prisma.integration.findFirst({ where: { type: 'GITHUB' } });
  if (!integration) throw new Error('No GITHUB integration found. Run pnpm db:seed first.');

  const existing = await prisma.gitHubInstallation.findFirst({ where: { accountLogin } });
  if (existing) {
    console.log(`EXISTING installationId=${existing.id}`);
    return;
  }

  const created = await prisma.gitHubInstallation.create({
    data: {
      integrationId: integration.id,
      githubInstallationId: BigInt(Date.now()),
      accountLogin,
      accountType: 'User',
      repositories: [repository],
    },
  });
  console.log(`CREATED installationId=${created.id}`);
}

main()
  .catch(e => {
    console.error('FAILED:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

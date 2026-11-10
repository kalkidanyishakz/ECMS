/**
 * Headless deterministic findings scan.
 *
 * Run:  npm run findings:scan                 (all projects)
 *       npm run findings:scan -- <projectId>  (one project)
 *
 * tsx resolves the `@/*` tsconfig path alias.
 */
import { db } from '@/lib/db';
import { generateFindings } from '@/lib/controls/findings';

async function main(): Promise<void> {
  const projectId = process.argv[2];
  const projects = projectId
    ? [{ id: projectId, name: projectId }]
    : await db.projects.findMany({
        select: { id: true, name: true },
        orderBy: { created_at: 'asc' },
      });

  if (projects.length === 0) {
    console.log('No projects found.');
    return;
  }

  let totalCreated = 0;
  for (const project of projects) {
    const result = await generateFindings(project.id);
    totalCreated += result.created;
    console.log(
      `[findings] ${project.name} (${project.id}): created=${result.created} skipped=${result.skipped}`
    );
  }
  console.log(`[findings] done. ${totalCreated} new finding(s) across ${projects.length} project(s).`);
}

main()
  .catch((error) => {
    console.error('[findings] fatal', error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

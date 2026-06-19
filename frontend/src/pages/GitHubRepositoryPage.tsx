import { Github } from 'lucide-react';

export function GitHubRepositoryPage() {
  return (
    <main className="flex h-full min-h-0 flex-1 items-center justify-center bg-[var(--surface-1)] px-6 text-[var(--ink)]">
      <section className="w-full max-w-[520px] rounded-[18px] border border-[var(--hairline)] bg-[var(--surface-2)] p-8 text-center shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-4)] text-[var(--ink-subtle)]">
          <Github aria-hidden="true" className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-[22px] font-bold leading-tight text-[var(--ink)]">
          GitHub tools moved
        </h1>
        <p className="mt-3 text-[14px] font-medium leading-6 text-[var(--ink-subtle)]">
          Repository connection, issue sync, and pull request workflows now live
          inside project settings and the Issue page.
        </p>
      </section>
    </main>
  );
}

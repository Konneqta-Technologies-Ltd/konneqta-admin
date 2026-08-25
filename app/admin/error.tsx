"use client";

/**
 * Error boundary for every /admin page. Keeps DB/network failures inside the
 * admin shell with a retry action instead of the raw Next.js error page.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-6">
        <h1 className="text-lg font-semibold text-red-200">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-red-200/80">
          The page failed to load. This is usually temporary — try again. If it
          keeps happening, contact a Super Admin and include the reference
          below.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-red-300/70">
            Ref: {error.digest}
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-200"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

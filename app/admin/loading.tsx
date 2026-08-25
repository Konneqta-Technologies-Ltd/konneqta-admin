/**
 * Skeleton shown while any /admin page's server data resolves. Without this
 * the shell renders blank until every Supabase round trip finishes.
 */
export default function AdminLoading() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse" aria-busy="true">
      <div className="h-3 w-32 rounded bg-zinc-800" />
      <div className="mt-4 h-8 w-64 rounded bg-zinc-800" />
      <div className="mt-2 h-4 w-96 rounded bg-zinc-900" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-28 rounded-2xl border border-zinc-800 bg-zinc-900"
          />
        ))}
      </div>
      <div className="mt-8 h-72 rounded-2xl border border-zinc-800 bg-zinc-900" />
    </div>
  );
}

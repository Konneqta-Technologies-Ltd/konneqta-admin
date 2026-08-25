import Link from "next/link";

/**
 * Rendered by notFound() in the customer detail page when the id doesn't
 * exist (previously fell through to the generic Next.js 404).
 */
export default function CustomerNotFound() {
  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-lg font-semibold">Customer not found</h1>
        <p className="mt-2 text-sm text-zinc-400">
          This user doesn&apos;t exist or has been deleted.
        </p>
        <Link
          href="/admin/users"
          className="mt-4 inline-flex rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
        >
          ← Back to users
        </Link>
      </div>
    </div>
  );
}

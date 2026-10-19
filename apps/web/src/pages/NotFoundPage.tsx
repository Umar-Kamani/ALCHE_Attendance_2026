import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-cloud px-4">
      <div className="max-w-lg rounded-3xl border border-mist bg-snow p-8 text-center shadow-xl">
        <p className="text-caption font-medium uppercase tracking-caption text-slate">404</p>
        <h1 className="mt-1 text-heading-sm font-medium tracking-heading-sm text-ink">
          That page does not exist
        </h1>
        <p className="mt-2 text-body-sm text-slate">
          The address may be mistyped, or the screen may have moved.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full-2 bg-monday-violet px-6 text-body-sm font-medium text-snow"
        >
          Return home
        </Link>
      </div>
    </main>
  );
}

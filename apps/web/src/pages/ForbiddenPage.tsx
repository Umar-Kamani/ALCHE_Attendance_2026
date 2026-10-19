import { Link } from 'react-router-dom';
import { ShieldIcon } from '../components/icons';

export function ForbiddenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-cloud px-4">
      <div className="max-w-lg rounded-3xl border border-mist bg-snow p-8 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full-2 bg-periwinkle text-slate">
          <ShieldIcon size={28} />
        </div>
        <p className="text-caption font-medium uppercase tracking-caption text-slate">403</p>
        <h1 className="mt-1 text-heading-sm font-medium tracking-heading-sm text-ink">
          This area is not available to your role
        </h1>
        <p className="mt-2 text-body-sm text-slate">
          Your account is signed in, but it does not have permission to view this screen. Ask HR if
          you believe this is a mistake.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full-2 bg-monday-violet px-6 text-body-sm font-medium text-snow"
        >
          Go to my home screen
        </Link>
      </div>
    </main>
  );
}

import { PageHeader, Card } from '../components/ui';

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-16">
      <PageHeader title={title} description={description} />
      <Card>
        <p className="text-body text-slate">
          This screen is part of the working build and will be completed in its delivery phase.
        </p>
      </Card>
    </div>
  );
}

import Badge from '@/components/Badge';

export default function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="mb-4 flex items-center gap-2 px-1 text-xl font-semibold tracking-tight text-foreground">
      {title}
      <Badge size="sm">{count}</Badge>
    </h2>
  );
}

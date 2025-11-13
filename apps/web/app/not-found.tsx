export const runtime = "edge";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">The resource you were looking for doesn&apos;t exist.</p>
    </div>
  );
}

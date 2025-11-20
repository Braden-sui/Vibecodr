"use client";

export default function LivePage() {
  return (
    <div className="flex items-center justify-center">
      <div className="mt-24 w-full max-w-2xl rounded-xl border p-8 text-center">
        <div className="mb-3 text-4xl">🐞</div>
        <h1 className="text-2xl font-semibold">You naughty little bugger!</h1>
        <p className="mt-2 text-muted-foreground">
          You’ve found a part of our site that isn’t quite live yet — stay tuned!
        </p>
      </div>
    </div>
  );
}

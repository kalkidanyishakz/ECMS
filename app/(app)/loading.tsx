export default function AppLoading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-56 animate-pulse rounded-md bg-ecms-card" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-24 animate-pulse rounded-xl border border-ecms-border bg-ecms-card" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl border border-ecms-border bg-ecms-card" />
    </div>
  );
}

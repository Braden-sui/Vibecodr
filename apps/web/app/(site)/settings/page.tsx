// Route: /settings — Account & plan
// Responsibilities
// - Manage profile, auth providers
// - Show plan usage (runs, storage), upgrade CTAs
// TODOs
// - Connect to billing later; for now, show quotas and usage

export default function SettingsPage() {
  return (
    <section>
      <h1>Settings</h1>
      <div className="vc-surface rounded-xl p-6">
        <h3 className="mb-4 text-lg font-semibold">Profile</h3>
        <p className="text-muted-foreground">TODO: avatar upload, handle, bio</p>
      </div>
      <div className="vc-surface rounded-xl p-6">
        <h3 className="mb-4 text-lg font-semibold">Plan</h3>
        <ul className="mb-4 space-y-2 text-sm">
          <li>Runs used: 0 / 5,000</li>
          <li>Storage used: 0.0 GB / 1 GB</li>
        </ul>
        <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Upgrade
        </button>
      </div>
    </section>
  );
}

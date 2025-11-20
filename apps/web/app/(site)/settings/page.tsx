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
      <div>
        <h3>Profile</h3>
        <p>TODO: avatar upload, handle, bio</p>
      </div>
      <div>
        <h3>Plan</h3>
        <ul>
          <li>Runs used: 0 / 5,000</li>
          <li>Storage used: 0.0 GB / 1 GB</li>
        </ul>
        <button>Upgrade</button>
      </div>
    </section>
  );
}

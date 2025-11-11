// Route: /profile/[handle] — Creator profile
// Responsibilities
// - Show avatar, bio, counts (Runs, Remixes), recent posts
// - Follow/unfollow controls
// TODOs
// - GET /users/:handle, /posts?author=:id

export default function ProfilePage({ params }: { params: { handle: string } }) {
  const { handle } = params;
  return (
    <section>
      <h1>Profile {handle}</h1>
      <p>TODO: fetch profile and render creator’s capsules and reports.</p>
      <button>Follow</button>
      <div style={{ marginTop: 16 }}>
        <strong>Recent</strong>
        <ul>
          <li>Boids Sim (App)</li>
          <li>Tiny Paint Notes (Report)</li>
        </ul>
      </div>
    </section>
  );
}


import { FeedCard } from "@/components/FeedCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function FeedPage() {
  // TODO: Fetch from API: GET /posts?mode=latest|following
  const mockPosts = [
    {
      id: "1",
      type: "app" as const,
      title: "Interactive Boids Simulation",
      description: "Watch flocking behavior emerge with adjustable parameters",
      author: {
        id: "user1",
        handle: "marta",
        name: "Marta Chen",
        avatarUrl: "/avatars/marta.png",
      },
      capsule: {
        id: "capsule1",
        runner: "client-static" as const,
        capabilities: {
          net: [],
          storage: false,
          workers: false,
        },
        params: [{ name: "count" }, { name: "speed" }],
      },
      tags: ["simulation", "canvas", "animation"],
      stats: {
        runs: 342,
        comments: 12,
        likes: 89,
        remixes: 5,
      },
      createdAt: "2025-11-10T15:30:00Z",
    },
    {
      id: "2",
      type: "report" as const,
      title: "Building a Tiny Paint App",
      description: "A walkthrough of creating a minimal canvas-based drawing tool",
      author: {
        id: "user2",
        handle: "tom",
        name: "Tom Anderson",
        avatarUrl: "/avatars/tom.png",
      },
      tags: ["tutorial", "canvas", "beginner"],
      stats: {
        runs: 0,
        comments: 8,
        likes: 45,
        remixes: 0,
      },
      createdAt: "2025-11-10T12:00:00Z",
    },
    {
      id: "3",
      type: "app" as const,
      title: "Weather Dashboard",
      description: "Real-time weather data with beautiful visualizations",
      author: {
        id: "user3",
        handle: "sarah_dev",
        name: "Sarah Johnson",
        avatarUrl: "/avatars/sarah.png",
      },
      capsule: {
        id: "capsule3",
        runner: "client-static" as const,
        capabilities: {
          net: ["api.openweathermap.org"],
          storage: true,
          workers: false,
        },
        params: [{ name: "city" }, { name: "units" }],
      },
      tags: ["weather", "api", "data-viz"],
      stats: {
        runs: 523,
        comments: 24,
        likes: 156,
        remixes: 12,
      },
      createdAt: "2025-11-09T18:45:00Z",
    },
    {
      id: "4",
      type: "app" as const,
      title: "Markdown Preview Editor",
      description: "Write and preview markdown in real-time with syntax highlighting",
      author: {
        id: "user4",
        handle: "alex_codes",
        name: "Alex Rivera",
        avatarUrl: "/avatars/alex.png",
      },
      capsule: {
        id: "capsule4",
        runner: "webcontainer" as const,
        capabilities: {
          net: ["cdn.jsdelivr.net"],
          storage: true,
          workers: false,
        },
        params: [{ name: "theme" }],
      },
      tags: ["markdown", "editor", "productivity"],
      stats: {
        runs: 789,
        comments: 34,
        likes: 234,
        remixes: 18,
      },
      createdAt: "2025-11-09T10:20:00Z",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Vibecodr Feed</h1>
          <p className="text-muted-foreground">
            Discover runnable apps and reports from the community
          </p>
        </div>
        <Button>Create New</Button>
      </div>

      {/* Feed Tabs */}
      <Tabs defaultValue="latest" className="w-full">
        <TabsList>
          <TabsTrigger value="latest">Latest</TabsTrigger>
          <TabsTrigger value="following">Following</TabsTrigger>
          <TabsTrigger value="trending" disabled>
            Trending
          </TabsTrigger>
        </TabsList>

        <TabsContent value="latest" className="mt-6">
          <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {mockPosts.map((post) => (
              <FeedCard key={post.id} post={post} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="following" className="mt-6">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground">
              Follow makers to see their posts here!
            </p>
            <Button className="mt-4" variant="outline">
              Discover Makers
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* TODO: Implement infinite scroll / pagination */}
      {/* TODO: Implement hover preview with IntersectionObserver */}
      {/* TODO: Connect to real API */}
    </div>
  );
}


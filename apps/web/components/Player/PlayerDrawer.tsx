"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { FileText, GitFork, MessageCircle } from "lucide-react";
import { Comments } from "@/components/Comments";

export interface PlayerDrawerProps {
  postId?: string;
  notes?: string;
  remixInfo?: {
    parentId?: string;
    changes: number;
  };
  comments?: Array<{
    id: string;
    user: string;
    text: string;
    timestamp: number;
  }>;
}

export function PlayerDrawer({
  postId,
  notes,
  remixInfo,
  comments = [],
  initialTab,
}: PlayerDrawerProps & { initialTab?: "notes" | "remix" | "chat" }) {
  const staticComments = !postId ? comments : [];
  return (
    <div className="flex h-full flex-col border-l bg-card">
      <Tabs defaultValue={initialTab ?? "notes"} className="flex h-full flex-col">
        <TabsList className="w-full justify-start rounded-none border-b">
          <TabsTrigger value="notes" className="gap-2">
            <FileText className="h-4 w-4" />
            Notes
          </TabsTrigger>
          <TabsTrigger value="remix" className="gap-2">
            <GitFork className="h-4 w-4" />
            Remix
          </TabsTrigger>
          <TabsTrigger value="chat" className="gap-2">
            <MessageCircle className="h-4 w-4" />
            Chat
            {postId == null && staticComments.length > 0 && (
              <span className="ml-1 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                {staticComments.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Notes Tab */}
        <TabsContent value="notes" className="flex-1 overflow-auto p-4">
          {notes ? (
            <div className="prose prose-sm max-w-none">
              <p className="text-sm text-muted-foreground">{notes}</p>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">No notes available</p>
            </div>
          )}
        </TabsContent>

        {/* Remix Tab */}
        <TabsContent value="remix" className="flex-1 overflow-auto p-4">
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Remix this vibe</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Fork this vibe to your studio and make your own changes
              </p>
            </div>

            {remixInfo?.parentId && (
              <Card className="p-3">
                <p className="text-xs text-muted-foreground">
                  This is a remix with {remixInfo.changes} changes from the original
                </p>
                <Button variant="link" size="sm" className="mt-2 h-auto p-0 text-xs">
                  View original vibe
                </Button>
              </Card>
            )}

            <Separator />

            <Button className="w-full gap-2">
              <GitFork className="h-4 w-4" />
              Fork to Studio
            </Button>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground">Quick changes:</h4>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>• Adjust parameters in real-time</p>
                <p>• View diff before forking</p>
                <p>• Publish as your own variant</p>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Chat Tab */}
        <TabsContent value="chat" className="flex-1 overflow-auto p-4">
          {postId ? (
            <Comments postId={postId} className="h-full" />
          ) : staticComments.length > 0 ? (
            <div className="space-y-4">
              {staticComments.map((comment) => (
                <div key={comment.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-500" />
                    <span className="text-sm font-medium">{comment.user}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(comment.timestamp).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="ml-8 text-sm text-muted-foreground">{comment.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2">
              <MessageCircle className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No comments yet</p>
              <Button variant="outline" size="sm" className="mt-2">
                Be the first to comment
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

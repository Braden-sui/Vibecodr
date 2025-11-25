import type { Handler } from "./types";
import {
  createArtifactUpload,
  uploadArtifactSources,
  completeArtifact,
  getArtifactManifest,
  getArtifactBundle,
} from "./handlers/artifacts";
import {
  publishCapsule,
  getCapsule,
  verifyCapsule,
  getUserQuota,
  listUserCapsules,
} from "./handlers/capsules";
import { createCapsuleRecipe, deleteCapsuleRecipe, listCapsuleRecipes, updateCapsuleRecipe } from "./handlers/recipes";
import { getRemixTree } from "./handlers/remixes";
import {
  likePost,
  unlikePost,
  getPostLikes,
  followUser,
  unfollowUser,
  getUserFollowers,
  getUserFollowing,
  createComment,
  getPostComments,
  deleteComment,
  getNotifications,
  markNotificationsRead,
  getUnreadCount,
  getNotificationSummary,
} from "./handlers/social";
import { getUserProfile, getUserPosts, checkFollowing, checkLiked } from "./handlers/profiles";
import { getProfileWithLayout, updateProfile, searchProfiles } from "./handlers/profile-extended";
import { syncUser } from "./handlers/users";
import { validateManifestHandler, getManifest, getCapsuleBundle } from "./handlers/manifest";
import {
  reportContent,
  getModerationReports,
  resolveModerationReport,
  filterContent,
  moderatePostAction,
  moderateCommentAction,
  getFlaggedPosts,
  getModerationAudit,
  getPostModerationStatus,
} from "./handlers/moderation";
import { netProxy } from "./handlers/proxy";
import { oEmbedHandler, embedIframeHandler, ogImageHandler } from "./handlers/embeds";
import { completeRun, appendRunLogs, startRun } from "./handlers/runs";
import { importGithub, importZip } from "./handlers/import";
import { joinLiveWaitlist } from "./handlers/live";
import { recordRuntimeEvent, getRuntimeAnalyticsSummary } from "./handlers/runtimeEvents";
import {
  getCapsuleFilesSummary,
  getCapsuleFile,
  updateCapsuleFile,
  updateCapsuleManifest,
  compileDraftArtifact,
  publishCapsuleDraft,
} from "./handlers/studio";
import { doStatus } from "./handlers/status";
import { updateUserPlan, searchUsers } from "./handlers/admin";
import { createPost, getDiscoverPosts, getPostById, getPosts, uploadCover } from "./handlers/posts";

export type Route = { method: string; pattern: RegExp; handler: Handler };

export const routes: Route[] = [
  // Manifest & Import
  { method: "POST", pattern: /^\/manifest\/validate$/, handler: validateManifestHandler },
  // Allow both /import/github and /capsules/import/github for compatibility
  { method: "POST", pattern: /^\/(?:capsules\/)?import\/github$/, handler: importGithub },
  { method: "POST", pattern: /^\/import\/zip$/, handler: importZip },

  // Artifacts
  { method: "POST", pattern: /^\/artifacts$/, handler: createArtifactUpload },
  { method: "PUT", pattern: /^\/artifacts\/([^\/]+)\/sources$/, handler: uploadArtifactSources },
  { method: "PUT", pattern: /^\/artifacts\/([^\/]+)\/complete$/, handler: completeArtifact },
  { method: "GET", pattern: /^\/artifacts\/([^\/]+)\/manifest$/, handler: getArtifactManifest },
  { method: "GET", pattern: /^\/artifacts\/([^\/]+)\/bundle$/, handler: getArtifactBundle },

  // Capsules
  { method: "POST", pattern: /^\/capsules\/publish$/, handler: publishCapsule },
  { method: "GET", pattern: /^\/capsules\/mine$/, handler: listUserCapsules },
  { method: "GET", pattern: /^\/capsules\/([^\/]+)$/, handler: getCapsule },
  { method: "GET", pattern: /^\/capsules\/([^\/]+)\/verify$/, handler: verifyCapsule },
  { method: "GET", pattern: /^\/capsules\/([^\/]+)\/manifest$/, handler: getManifest },
  { method: "GET", pattern: /^\/capsules\/([^\/]+)\/bundle$/, handler: getCapsuleBundle },
  { method: "GET", pattern: /^\/capsules\/([^\/]+)\/files-summary$/, handler: getCapsuleFilesSummary },
  { method: "GET", pattern: /^\/capsules\/([^\/]+)\/files\/(.+)$/, handler: getCapsuleFile },
  { method: "PUT", pattern: /^\/capsules\/([^\/]+)\/files\/(.+)$/, handler: updateCapsuleFile },
  { method: "PATCH", pattern: /^\/capsules\/([^\/]+)\/manifest$/, handler: updateCapsuleManifest },
  { method: "POST", pattern: /^\/capsules\/([^\/]+)\/compile-draft$/, handler: compileDraftArtifact },
  { method: "POST", pattern: /^\/capsules\/([^\/]+)\/publish$/, handler: publishCapsuleDraft },
  { method: "GET", pattern: /^\/capsules\/([^\/]+)\/recipes$/, handler: listCapsuleRecipes },
  { method: "POST", pattern: /^\/capsules\/([^\/]+)\/recipes$/, handler: createCapsuleRecipe },
  { method: "PATCH", pattern: /^\/capsules\/([^\/]+)\/recipes\/([^\/]+)$/, handler: updateCapsuleRecipe },
  { method: "DELETE", pattern: /^\/capsules\/([^\/]+)\/recipes\/([^\/]+)$/, handler: deleteCapsuleRecipe },
  { method: "GET", pattern: /^\/capsules\/([^\/]+)\/remixes$/, handler: getRemixTree },

  // User & Quota
  { method: "GET", pattern: /^\/user\/quota$/, handler: getUserQuota },

  // Profiles
  { method: "POST", pattern: /^\/users\/sync$/, handler: syncUser },
  { method: "GET", pattern: /^\/users\/([^\/]+)$/, handler: getUserProfile },
  { method: "GET", pattern: /^\/users\/([^\/]+)\/posts$/, handler: getUserPosts },
  { method: "GET", pattern: /^\/users\/([^\/]+)\/check-following$/, handler: checkFollowing },

  // Admin
  { method: "POST", pattern: /^\/admin\/users\/plan$/, handler: updateUserPlan },
  { method: "PATCH", pattern: /^\/admin\/users\/plan$/, handler: updateUserPlan },
  { method: "GET", pattern: /^\/admin\/users\/search$/, handler: searchUsers },

  // Extended profile feature
  { method: "GET", pattern: /^\/profile\/([^\/]+)$/, handler: getProfileWithLayout },
  { method: "PATCH", pattern: /^\/profile$/, handler: updateProfile },
  { method: "GET", pattern: /^\/profile\/search$/, handler: searchProfiles },

  // Follows
  { method: "POST", pattern: /^\/users\/([^\/]+)\/follow$/, handler: followUser },
  { method: "DELETE", pattern: /^\/users\/([^\/]+)\/follow$/, handler: unfollowUser },
  { method: "GET", pattern: /^\/users\/([^\/]+)\/followers$/, handler: getUserFollowers },
  { method: "GET", pattern: /^\/users\/([^\/]+)\/following$/, handler: getUserFollowing },

  // Posts & Feed
  { method: "GET", pattern: /^\/posts$/, handler: getPosts },
  { method: "GET", pattern: /^\/posts\/discover$/, handler: getDiscoverPosts },
  { method: "GET", pattern: /^\/posts\/([^\/]+)$/, handler: getPostById },
  { method: "POST", pattern: /^\/posts$/, handler: createPost },
  { method: "POST", pattern: /^\/covers$/, handler: uploadCover },

  // Likes
  { method: "POST", pattern: /^\/posts\/([^\/]+)\/like$/, handler: likePost },
  { method: "DELETE", pattern: /^\/posts\/([^\/]+)\/like$/, handler: unlikePost },
  { method: "GET", pattern: /^\/posts\/([^\/]+)\/likes$/, handler: getPostLikes },
  { method: "GET", pattern: /^\/posts\/([^\/]+)\/check-liked$/, handler: checkLiked },

  // Comments
  { method: "POST", pattern: /^\/posts\/([^\/]+)\/comments$/, handler: createComment },
  { method: "GET", pattern: /^\/posts\/([^\/]+)\/comments$/, handler: getPostComments },
  { method: "DELETE", pattern: /^\/comments\/([^\/]+)$/, handler: deleteComment },

  // Notifications
  { method: "GET", pattern: /^\/notifications$/, handler: getNotifications },
  { method: "GET", pattern: /^\/notifications\/summary$/, handler: getNotificationSummary },
  { method: "POST", pattern: /^\/notifications\/mark-read$/, handler: markNotificationsRead },
  { method: "GET", pattern: /^\/notifications\/unread-count$/, handler: getUnreadCount },

  // Runtime analytics
  { method: "POST", pattern: /^\/runtime-events$/, handler: recordRuntimeEvent },
  { method: "GET", pattern: /^\/runtime-analytics\/summary$/, handler: getRuntimeAnalyticsSummary },

  // Runs & Logs
  { method: "POST", pattern: /^\/runs\/start$/, handler: startRun },
  { method: "POST", pattern: /^\/runs\/([^\/]+)\/logs$/, handler: appendRunLogs },
  { method: "POST", pattern: /^\/runs\/complete$/, handler: completeRun },

  // Durable Object status
  { method: "GET", pattern: /^\/do\/status$/, handler: doStatus },

  // Moderation
  { method: "POST", pattern: /^\/moderation\/report$/, handler: reportContent },
  { method: "POST", pattern: /^\/moderation\/posts\/([^\/]+)\/action$/, handler: moderatePostAction },
  { method: "POST", pattern: /^\/moderation\/comments\/([^\/]+)\/action$/, handler: moderateCommentAction },
  { method: "GET", pattern: /^\/moderation\/posts\/([^\/]+)\/status$/, handler: getPostModerationStatus },
  { method: "GET", pattern: /^\/moderation\/reports$/, handler: getModerationReports },
  { method: "POST", pattern: /^\/moderation\/reports\/([^\/]+)\/resolve$/, handler: resolveModerationReport },
  { method: "GET", pattern: /^\/moderation\/flagged-posts$/, handler: getFlaggedPosts },
  { method: "GET", pattern: /^\/moderation\/audit$/, handler: getModerationAudit },
  { method: "POST", pattern: /^\/moderation\/filter-content$/, handler: filterContent },
  { method: "POST", pattern: /^\/live\/waitlist$/, handler: joinLiveWaitlist },

  // Embeds & SEO
  { method: "GET", pattern: /^\/oembed$/, handler: oEmbedHandler },
  { method: "GET", pattern: /^\/e\/([^\/]+)$/, handler: embedIframeHandler },
  { method: "GET", pattern: /^\/og-image\/([^\/]+)$/, handler: ogImageHandler },

  // Network Proxy
  { method: "GET", pattern: /^\/proxy$/, handler: netProxy },
];

// One profile row shared by search results, follower/following lists, and
// the requests inbox (where `action` is overridden with Accept/Reject
// controls). Twin of prog-strength-web components/social/ProfileRow.tsx.
//
// The avatar + name navigate to the user's profile when they have a
// `username` handle (a handle-less user — `username` null — renders
// un-tappable, since the profile route is addressed by handle). By default
// the row's trailing slot is a <FollowButton> carrying the row's own
// `relationship`; `self` renders a muted "You" instead, and callers can
// pass `action` to swap in their own controls.
import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { ProfileSummary, Relationship } from "@/lib/api";
import { Avatar } from "./avatar";
import { FollowButton } from "./follow-button";

export function ProfileRow({
  user,
  onRelationshipChange,
  action,
}: {
  user: ProfileSummary;
  onRelationshipChange?: (next: Relationship) => void;
  action?: ReactNode;
}) {
  const router = useRouter();
  const handle = user.username;

  const identity = (
    <View className="min-w-0 flex-1 flex-row items-center gap-3">
      <Avatar url={user.avatar_url} name={user.display_name} size={40} />
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
          {user.display_name}
        </Text>
        {handle ? (
          <Text className="text-xs text-muted" numberOfLines={1}>
            @{handle}
          </Text>
        ) : null}
      </View>
    </View>
  );

  // Trailing control: caller-provided `action` wins; otherwise the
  // relationship action — "You" for self, a FollowButton (needs a handle)
  // otherwise.
  let trailing: ReactNode = null;
  if (action !== undefined) {
    trailing = action;
  } else if (user.relationship === "self") {
    trailing = <Text className="text-xs text-muted">You</Text>;
  } else if (handle) {
    trailing = (
      <FollowButton
        username={handle}
        relationship={user.relationship}
        onChange={onRelationshipChange}
        size="sm"
      />
    );
  }

  return (
    <View className="flex-row items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      {handle ? (
        <Pressable
          onPress={() => router.push(`/u/${handle}`)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${user.display_name}'s profile`}
          className="min-h-11 min-w-0 flex-1 flex-row items-center active:opacity-80"
        >
          {identity}
        </Pressable>
      ) : (
        <View className="min-h-11 min-w-0 flex-1 flex-row items-center">{identity}</View>
      )}
      {trailing ? <View className="shrink-0">{trailing}</View> : null}
    </View>
  );
}

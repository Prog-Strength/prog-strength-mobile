// Public profile — `/u/{username}`. Pushed from search rows, follower/
// following lists, the requests inbox, and the Settings "My profile" row;
// lives outside (tabs) so it presents full-screen with a back affordance.
// Parity with web app/(app)/u/[username]/page.tsx.
//
// Header carries the avatar, display name, @handle, follower/following
// counts (tappable → the list screens), and a context-sensitive primary
// action driven by `relationship` (Edit profile when self, otherwise a
// <FollowButton>). Below it, the activities section renders the
// viewer-scoped feed (or a locked/empty state) via <ProfileActivityFeed>.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import { getProfile, type PublicProfile, type Relationship } from "@/lib/api";
import { Avatar } from "@/components/social/avatar";
import { FollowButton } from "@/components/social/follow-button";
import { ProfileActivityFeed } from "@/components/social/profile-activity-feed";

const HEADER_OPTIONS = {
  title: "Profile",
  headerShown: true,
  headerStyle: { backgroundColor: "#0a0a0b" },
  headerTitleStyle: { color: "#fafafa" },
  headerTintColor: "#fafafa",
  headerShadowVisible: false,
} as const;

export default function ProfileScreen() {
  const router = useRouter();
  const { username } = useLocalSearchParams<{ username: string }>();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (!token) {
        router.replace("/login");
        return;
      }
      try {
        const p = await getProfile(token, username);
        if (cancelled) return;
        setProfile(p);
        setError(null);
        setNotFound(false);
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Could not load profile";
        if (msg.toLowerCase().includes("401")) {
          await clearToken();
          router.replace("/login");
          return;
        }
        if (msg.toLowerCase().includes("not found")) {
          setNotFound(true);
          return;
        }
        setError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, router]);

  // Reconcile the header's follower count when the viewer follows/unfollows
  // so the count stays consistent with the button without a refetch.
  const onRelationshipChange = useCallback((next: Relationship) => {
    setProfile((p) => {
      if (!p) return p;
      const wasFollowing = p.relationship === "following";
      const nowFollowing = next === "following";
      const delta = (nowFollowing ? 1 : 0) - (wasFollowing ? 1 : 0);
      return { ...p, relationship: next, follower_count: Math.max(0, p.follower_count + delta) };
    });
  }, []);

  if (notFound) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-background px-6">
        <Stack.Screen options={HEADER_OPTIONS} />
        <Text className="text-sm font-medium text-foreground">Profile not found</Text>
        <Pressable onPress={() => router.replace("/search")} accessibilityRole="button" hitSlop={8}>
          <Text className="text-xs text-accent">Search people</Text>
        </Pressable>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Stack.Screen options={HEADER_OPTIONS} />
        <Text className="text-center text-sm text-danger">{error}</Text>
      </View>
    );
  }

  if (!profile) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={HEADER_OPTIONS} />
        <ActivityIndicator color="#fafafa" />
      </View>
    );
  }

  const handle = profile.username ?? username;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 px-4 py-4 pb-12">
      <Stack.Screen options={{ ...HEADER_OPTIONS, title: handle ? `@${handle}` : "Profile" }} />

      {/* ---- Header ---- */}
      <View className="gap-4 border-b border-border pb-6">
        <View className="flex-row items-start justify-between gap-4">
          <View className="min-w-0 flex-1 flex-row items-center gap-4">
            <Avatar url={profile.avatar_url} name={profile.display_name} size={64} />
            <View className="min-w-0 flex-1">
              <Text className="text-xl font-semibold text-foreground" numberOfLines={1}>
                {profile.display_name}
              </Text>
              {profile.username ? (
                <Text className="text-sm text-muted" numberOfLines={1}>
                  @{profile.username}
                </Text>
              ) : null}
            </View>
          </View>

          <View className="shrink-0">
            {profile.relationship === "self" ? (
              <Pressable
                onPress={() => router.push("/settings")}
                accessibilityRole="button"
                accessibilityLabel="Edit profile"
                hitSlop={8}
                className="min-h-11 flex-row items-center justify-center rounded-full border border-border bg-surface px-4 py-1.5 active:opacity-80"
              >
                <Text className="text-sm font-medium text-muted">Edit profile</Text>
              </Pressable>
            ) : handle ? (
              <FollowButton
                username={handle}
                relationship={profile.relationship}
                onChange={onRelationshipChange}
              />
            ) : null}
          </View>
        </View>

        <View className="flex-row items-center gap-6">
          <Pressable
            onPress={() => handle && router.push(`/u/${handle}/followers`)}
            disabled={!handle}
            accessibilityRole="button"
            accessibilityLabel="View followers"
            hitSlop={8}
            className="min-h-11 flex-row items-baseline gap-1.5 active:opacity-80"
          >
            <Text className="text-sm font-semibold tabular-nums text-foreground">
              {profile.follower_count}
            </Text>
            <Text className="text-sm text-muted">Followers</Text>
          </Pressable>
          <Pressable
            onPress={() => handle && router.push(`/u/${handle}/following`)}
            disabled={!handle}
            accessibilityRole="button"
            accessibilityLabel="View following"
            hitSlop={8}
            className="min-h-11 flex-row items-baseline gap-1.5 active:opacity-80"
          >
            <Text className="text-sm font-semibold tabular-nums text-foreground">
              {profile.following_count}
            </Text>
            <Text className="text-sm text-muted">Following</Text>
          </Pressable>
        </View>
      </View>

      {/* ---- Activity ---- */}
      <View className="gap-3">
        <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Activity
        </Text>
        {handle ? <ProfileActivityFeed username={handle} /> : null}
      </View>
    </ScrollView>
  );
}

// Followers list — `/u/{username}/followers`. Reached from the profile
// header's "Followers" count. Paginated via <ProfileListView>; each row is
// a <ProfileRow> (tap → profile) with its own follow action. Parity with
// web app/(app)/u/[username]/followers/page.tsx.
import { useCallback } from "react";
import { ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { getToken } from "@/lib/auth";
import { listFollowers } from "@/lib/api";
import { ProfileListView } from "@/components/social/profile-list-view";

const HEADER_OPTIONS = {
  title: "Followers",
  headerShown: true,
  headerStyle: { backgroundColor: "#0a0a0b" },
  headerTitleStyle: { color: "#fafafa" },
  headerTintColor: "#fafafa",
  headerShadowVisible: false,
} as const;

export default function FollowersScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();

  const fetchPage = useCallback(
    async (cursor?: string) => {
      const token = await getToken();
      if (!token) return { users: [], next_cursor: null };
      return listFollowers(token, username, cursor);
    },
    [username],
  );

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-4 py-4 pb-12">
      <Stack.Screen options={HEADER_OPTIONS} />
      <View>
        <ProfileListView fetchPage={fetchPage} emptyMessage="No followers yet." />
      </View>
    </ScrollView>
  );
}

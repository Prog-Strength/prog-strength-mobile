// Header avatar → Settings. 28pt circle showing the uploaded/OAuth
// avatar, or the user's initials as fallback. Rendered as headerRight
// on every tab header — the iOS-conventional account entry point,
// mirroring the web sidebar's account anchor (Settings gets no tab;
// the five slots are taken).
import { Image, Pressable, Text } from "react-native";
import { useRouter } from "expo-router";
import { useProfile } from "@/lib/profile-context";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function AvatarButton() {
  const router = useRouter();
  const { profile } = useProfile();

  return (
    <Pressable
      onPress={() => router.push("/settings")}
      accessibilityRole="button"
      accessibilityLabel="Settings"
      // 28pt visual + hitSlop ≥ the SOW's 44pt touch-target floor.
      hitSlop={10}
      className="mr-4 h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-border bg-surface active:opacity-80"
    >
      {profile?.avatar_url ? (
        <Image
          source={{ uri: profile.avatar_url }}
          className="h-7 w-7"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text className="text-[10px] font-semibold text-muted">
          {profile ? initials(profile.display_name) : "…"}
        </Text>
      )}
    </Pressable>
  );
}

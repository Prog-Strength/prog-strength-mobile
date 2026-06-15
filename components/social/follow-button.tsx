// The follow primary-action button — the one reusable optimistic state
// machine shared by the profile header, search rows, and follower/following
// list rows. Twin of prog-strength-web components/social/FollowButton.tsx.
//
// It maps the viewer's `relationship` to a label + action and flips local
// state OPTIMISTICALLY before the API call settles, rolling back + showing
// an Alert on failure. The state machine:
//
//   - none      → "Follow"     → requestFollow → "following" or "requested"
//                 (a public target follows immediately; a private one becomes
//                 a pending request — the API returns the resulting edge, so
//                 we reconcile to its `relationship` rather than guessing)
//   - requested → "Requested"  → cancelOrUnfollow → "none"  (cancel)
//   - following → "Following"  → cancelOrUnfollow → "none"  (unfollow,
//                 confirmed via Alert since there's no hover-to-reveal here)
//   - pending_incoming → "Accept" → acceptFollow → "following"
//   - self      → renders nothing (the caller shows an "Edit profile" action)
//
// `onChange` lets a parent (e.g. the profile header counts, or a list row
// that wants to drop itself) react to a settled relationship transition.
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text } from "react-native";
import { getToken } from "@/lib/auth";
import { acceptFollow, cancelOrUnfollow, requestFollow, type Relationship } from "@/lib/api";

export function FollowButton({
  username,
  relationship,
  onChange,
  size = "md",
}: {
  username: string;
  relationship: Relationship;
  onChange?: (next: Relationship) => void;
  size?: "sm" | "md";
}) {
  const [rel, setRel] = useState<Relationship>(relationship);
  const [pending, setPending] = useState(false);

  // The button never renders for `self`; the profile header swaps in an
  // "Edit profile" action for that case.
  if (rel === "self") return null;

  // min-h-11 keeps the visible affordance at the 44pt iOS touch-target floor
  // (hitSlop expands the hit area, but the visible control should meet it too).
  const padding = size === "sm" ? "min-h-11 px-3 py-1" : "min-h-11 px-4 py-1.5";
  const textSize = size === "sm" ? "text-xs" : "text-sm";

  // Each transition: optimistically set `next`, fire the API, reconcile to
  // the server's truth where it returns an edge, roll back to `prev` on error.
  const run = async (
    optimistic: Relationship,
    op: (token: string) => Promise<Relationship>,
    failMsg: string,
  ) => {
    if (pending) return;
    const token = await getToken();
    if (!token) return;
    const prev = rel;
    setRel(optimistic);
    setPending(true);
    try {
      const settled = await op(token);
      setRel(settled);
      onChange?.(settled);
    } catch (err: unknown) {
      setRel(prev);
      Alert.alert("Follow", err instanceof Error ? err.message : failMsg);
    } finally {
      setPending(false);
    }
  };

  const follow = () =>
    // Optimistically show "Requested"; reconcile to the edge the API returns
    // (a public target comes back "following", a private one "requested").
    run(
      "requested",
      async (token) => (await requestFollow(token, username)).relationship,
      "Could not follow",
    );

  const cancelRequest = () =>
    run(
      "none",
      async (token) => {
        await cancelOrUnfollow(token, username);
        return "none";
      },
      "Could not update follow",
    );

  const unfollow = () =>
    // Confirm before tearing down an accepted edge (no hover-to-reveal on touch).
    Alert.alert("Unfollow?", `Stop following @${username}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unfollow",
        style: "destructive",
        onPress: () =>
          run(
            "none",
            async (token) => {
              await cancelOrUnfollow(token, username);
              return "none";
            },
            "Could not unfollow",
          ),
      },
    ]);

  const accept = () =>
    run(
      "following",
      async (token) => (await acceptFollow(token, username)).relationship,
      "Could not accept request",
    );

  const solidBase = `flex-row items-center justify-center rounded-full bg-accent ${padding} active:opacity-80`;
  const outlineBase = `flex-row items-center justify-center rounded-full border border-border bg-surface ${padding} active:opacity-80`;

  if (rel === "none") {
    return (
      <Pressable
        onPress={follow}
        disabled={pending}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Follow"
        className={`${solidBase} ${pending ? "opacity-50" : ""}`}
      >
        {pending ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text className={`font-medium text-accent-fg ${textSize}`}>Follow</Text>
        )}
      </Pressable>
    );
  }

  if (rel === "requested") {
    return (
      <Pressable
        onPress={cancelRequest}
        disabled={pending}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Cancel follow request"
        className={`${outlineBase} ${pending ? "opacity-50" : ""}`}
      >
        <Text className={`font-medium text-muted ${textSize}`}>Requested</Text>
      </Pressable>
    );
  }

  if (rel === "following") {
    return (
      <Pressable
        onPress={unfollow}
        disabled={pending}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Unfollow"
        className={`${outlineBase} ${pending ? "opacity-50" : ""}`}
      >
        <Text className={`font-medium text-muted ${textSize}`}>Following</Text>
      </Pressable>
    );
  }

  // pending_incoming — they've asked to follow the viewer.
  return (
    <Pressable
      onPress={accept}
      disabled={pending}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Accept follow request"
      className={`${solidBase} ${pending ? "opacity-50" : ""}`}
    >
      {pending ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Text className={`font-medium text-accent-fg ${textSize}`}>Accept</Text>
      )}
    </Pressable>
  );
}

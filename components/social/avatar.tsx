// Circular avatar shared across the social surfaces (profile header,
// search rows, follower/following lists, requests inbox): the resolved
// image when present, otherwise an initials placeholder derived from the
// display name. Mirrors prog-strength-web components/social/Avatar.tsx.
//
// The header has its own 28pt avatar baked into the AvatarButton; this is
// the cross-screen version used wherever a ProfileSummary is rendered,
// sized via the `size` prop (defaults to a 40px list-row avatar).
import { Image, Text, View } from "react-native";

export function Avatar({
  url,
  name,
  size = 40,
}: {
  url: string | null;
  name: string;
  size?: number;
}) {
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className="items-center justify-center bg-surface"
    >
      <Text
        style={{ fontSize: Math.max(10, Math.round(size * 0.38)) }}
        className="font-semibold uppercase text-foreground"
      >
        {initials(name)}
      </Text>
    </View>
  );
}

/** First two word-initials of a name, e.g. "Sam Lifter" → "SL". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

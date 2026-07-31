// Full-screen activity-photo viewer. A dark, edge-to-edge RN Modal that
// shows the full-size (`url`) variant with prev/next navigation, a close
// affordance, and the caption beneath. Android hardware-back closes via
// `onRequestClose`. Deliberately simple: prev/next buttons rather than a
// pan/pinch gesture surface (matches the mobile "capture + display" scope;
// a zoomable gallery is a later item).
import { useEffect, useState } from "react";
import { Image, Modal, Pressable, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ActivityPhoto } from "@/lib/api";

export function PhotoViewerModal({
  photos,
  index,
  onClose,
}: {
  // The full ordered photo set; the viewer pages within it.
  photos: ActivityPhoto[];
  // The photo to open at, or null when the viewer is closed.
  index: number | null;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  // Local cursor so prev/next don't have to round-trip through the parent.
  // Re-seeded whenever the parent opens the viewer at a new index.
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (index != null) setCurrent(index);
  }, [index]);

  const open = index != null && photos.length > 0;
  // Clamp defensively — a delete elsewhere could shrink the set while open.
  const safeIndex = Math.min(current, photos.length - 1);
  const photo = open ? photos[safeIndex] : undefined;

  return (
    <Modal visible={open} onRequestClose={onClose} animationType="fade" transparent>
      <View className="flex-1 bg-black">
        {photo && (
          <>
            {/* Tap the backdrop image to dismiss (common gallery affordance). */}
            <Pressable className="flex-1 items-center justify-center" onPress={onClose}>
              <Image
                source={{ uri: photo.url }}
                resizeMode="contain"
                // Fill the screen; contain preserves aspect within it.
                style={{ width, height }}
                accessibilityIgnoresInvertColors
              />
            </Pressable>

            {/* Close button — top-right, safe-area-ish inset. */}
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close photo viewer"
              hitSlop={12}
              className="absolute right-4 top-14 h-11 w-11 items-center justify-center rounded-full bg-black/50 active:opacity-70"
            >
              <Ionicons name="close" size={26} color="#fafafa" />
            </Pressable>

            {/* Prev / next — only when there's more than one photo. */}
            {photos.length > 1 && (
              <>
                {safeIndex > 0 && (
                  <Pressable
                    onPress={() => setCurrent(safeIndex - 1)}
                    accessibilityRole="button"
                    accessibilityLabel="Previous photo"
                    hitSlop={8}
                    className="absolute left-3 top-1/2 h-11 w-11 items-center justify-center rounded-full bg-black/50 active:opacity-70"
                  >
                    <Ionicons name="chevron-back" size={26} color="#fafafa" />
                  </Pressable>
                )}
                {safeIndex < photos.length - 1 && (
                  <Pressable
                    onPress={() => setCurrent(safeIndex + 1)}
                    accessibilityRole="button"
                    accessibilityLabel="Next photo"
                    hitSlop={8}
                    className="absolute right-3 top-1/2 h-11 w-11 items-center justify-center rounded-full bg-black/50 active:opacity-70"
                  >
                    <Ionicons name="chevron-forward" size={26} color="#fafafa" />
                  </Pressable>
                )}
              </>
            )}

            {/* Caption + counter footer. */}
            <View className="absolute inset-x-0 bottom-0 gap-1 px-6 pb-12 pt-6">
              {photo.caption && photo.caption.trim().length > 0 && (
                <Text className="text-center text-sm text-white">{photo.caption}</Text>
              )}
              {photos.length > 1 && (
                <Text className="text-center text-xs text-white/60">
                  {safeIndex + 1} / {photos.length}
                </Text>
              )}
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

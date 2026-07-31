// Horizontal thumbnail strip for an activity's photos. Renders each
// photo as a fixed-height thumbnail whose width follows its aspect
// ratio, with the "Add photo" affordance at the end. Tapping a thumb
// opens the full-screen PhotoViewerModal at that index; long-pressing a
// thumb offers a delete confirmation. This screen only ever shows the
// viewer's OWN activity, so owner actions are always allowed. Caption
// editing and reorder are intentionally out of the mobile core scope.
import { useState } from "react";
import { Alert, Image, Pressable, ScrollView, View } from "react-native";
import { getToken } from "@/lib/auth";
import { deleteActivityPhoto, type ActivityPhoto } from "@/lib/api";
import { PhotoViewerModal } from "@/components/activities/photo-viewer-modal";
import { PhotoAddButton } from "@/components/activities/photo-add-button";

// Thumbnail box height; width is derived per-photo from its aspect
// ratio (clamped so extreme panoramas / verticals stay tappable).
const THUMB_HEIGHT = 104;
const MIN_THUMB_WIDTH = 64;
const MAX_THUMB_WIDTH = 200;

export function PhotoStrip({
  photos,
  activityId,
  onChanged,
}: {
  photos: ActivityPhoto[];
  activityId: string;
  onChanged: () => void;
}) {
  // Which photo the full-screen viewer is open on (null = closed).
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  function confirmDelete(photo: ActivityPhoto) {
    Alert.alert("Delete photo?", "This photo will be permanently removed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const token = await getToken();
            if (!token) return;
            await deleteActivityPhoto(token, activityId, photo.id);
            onChanged();
          } catch (err) {
            Alert.alert("Delete failed", err instanceof Error ? err.message : String(err));
          }
        },
      },
    ]);
  }

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="flex-row items-center gap-3 px-4"
      >
        {photos.map((photo, i) => {
          const ratio = photo.height > 0 ? photo.width / photo.height : 1;
          const width = Math.max(MIN_THUMB_WIDTH, Math.min(MAX_THUMB_WIDTH, THUMB_HEIGHT * ratio));
          return (
            <Pressable
              key={photo.id}
              onPress={() => setOpenIndex(i)}
              onLongPress={() => confirmDelete(photo)}
              accessibilityRole="imagebutton"
              accessibilityLabel={
                photo.caption && photo.caption.trim().length > 0
                  ? `Photo: ${photo.caption}`
                  : `Photo ${i + 1}`
              }
              style={{ width, height: THUMB_HEIGHT }}
              className="overflow-hidden rounded-lg border border-border bg-surface active:opacity-80"
            >
              <Image
                source={{ uri: photo.thumb_url }}
                resizeMode="cover"
                style={{ width, height: THUMB_HEIGHT }}
                accessibilityIgnoresInvertColors
              />
            </Pressable>
          );
        })}

        {/* The Add button lives at the end of the strip (or is the only
            child when there are no photos yet). */}
        <PhotoAddButton activityId={activityId} onChanged={onChanged} />
      </ScrollView>

      <PhotoViewerModal photos={photos} index={openIndex} onClose={() => setOpenIndex(null)} />
    </View>
  );
}

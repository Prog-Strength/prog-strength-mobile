// "Add photo" action for an activity's photo strip. Offers camera or
// library on iOS via ActionSheetIOS (matching the run-detail ellipsis
// menu and the settings avatar flow), and a two-button Alert on Android.
// The picked asset is downscaled with expo-image-manipulator BEFORE
// upload — bandwidth only; the server re-clamps to its own cap
// authoritatively. Mirrors settings.tsx's avatar picker (permission
// request + denial Alert, asset→PickedImage mapping, error Alert).
import { useState } from "react";
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, Pressable, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
// expo-image-manipulator@55 exposes BOTH the new contextual
// `ImageManipulator.manipulate()` API and the legacy `manipulateAsync`
// (confirmed via node_modules/.../build/index.d.ts, which re-exports
// `manipulateAsync` and `SaveFormat`). We use the legacy one-shot form:
// it maps directly to "resize long edge, re-encode JPEG" with no manual
// context lifecycle to manage.
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { getToken } from "@/lib/auth";
import { uploadActivityPhoto, type PickedImage } from "@/lib/api";

// Long-edge target for the client-side downscale. The server re-clamps
// to its own cap, so this only trims upload bandwidth for large captures.
const MAX_EDGE = 2048;

// Map the API's status-coded failures to friendlier copy. `unwrap`
// throws `Error(body.error)` (the server's message) for these, so we
// substring-match the common cases and otherwise surface the raw message.
function friendlyUploadError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("413") || m.includes("too large") || m.includes("payload")) {
    return "That photo is too large. Try a smaller image.";
  }
  if (m.includes("415") || m.includes("unsupported") || m.includes("media type")) {
    return "That file type isn't supported. Use a JPEG, PNG, or WebP image.";
  }
  if (m.includes("409") || m.includes("limit") || m.includes("too many")) {
    return "This activity already has the maximum number of photos.";
  }
  if (m.includes("503") || m.includes("unavailable")) {
    return "Photo uploads are temporarily unavailable. Please try again shortly.";
  }
  return message;
}

export function PhotoAddButton({
  activityId,
  onChanged,
}: {
  activityId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  // Downscale the picked asset to ~MAX_EDGE on its longest edge and
  // re-encode as JPEG. `resize` with only `width` OR `height` preserves
  // aspect ratio, so we constrain whichever dimension is longer.
  async function downscale(asset: ImagePicker.ImagePickerAsset): Promise<PickedImage> {
    const longEdge = Math.max(asset.width ?? 0, asset.height ?? 0);
    if (longEdge <= MAX_EDGE) {
      // Small enough already — still normalize to JPEG for a consistent
      // upload type, but skip the resize action.
      const out = await manipulateAsync(asset.uri, [], {
        compress: 0.8,
        format: SaveFormat.JPEG,
      });
      return { uri: out.uri, mimeType: "image/jpeg", fileName: "photo.jpg" };
    }
    const resize =
      (asset.width ?? 0) >= (asset.height ?? 0) ? { width: MAX_EDGE } : { height: MAX_EDGE };
    const out = await manipulateAsync(asset.uri, [{ resize }], {
      compress: 0.8,
      format: SaveFormat.JPEG,
    });
    return { uri: out.uri, mimeType: "image/jpeg", fileName: "photo.jpg" };
  }

  async function pickAndUpload(source: "camera" | "library") {
    // Request the appropriate permission and bail with an Alert on denial.
    if (source === "camera") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Camera access needed", "Enable camera access in Settings to take a photo.");
        return;
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Photo access needed",
          "Enable photo-library access in Settings to choose a photo.",
        );
        return;
      }
    }

    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    if (result.canceled || !result.assets[0]) return;

    setBusy(true);
    try {
      const picked = await downscale(result.assets[0]);
      const token = await getToken();
      if (!token) return;
      await uploadActivityPhoto(token, activityId, picked);
      onChanged();
    } catch (err) {
      Alert.alert(
        "Upload failed",
        friendlyUploadError(err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setBusy(false);
    }
  }

  function openMenu() {
    if (busy) return;
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Take Photo", "Choose from Library", "Cancel"],
          cancelButtonIndex: 2,
        },
        (i) => {
          if (i === 0) void pickAndUpload("camera");
          if (i === 1) void pickAndUpload("library");
        },
      );
    } else {
      Alert.alert("Add photo", undefined, [
        { text: "Take Photo", onPress: () => void pickAndUpload("camera") },
        { text: "Choose from Library", onPress: () => void pickAndUpload("library") },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  }

  return (
    <Pressable
      onPress={openMenu}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Add photo"
      className="h-24 w-24 items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-surface active:opacity-70 disabled:opacity-50"
    >
      {busy ? (
        <ActivityIndicator color="#fafafa" />
      ) : (
        <>
          <Ionicons name="camera-outline" size={24} color="#a1a1aa" />
          <Text className="text-[10px] font-medium text-muted">Add photo</Text>
        </>
      )}
    </Pressable>
  );
}

// Settings — profile, units, usage. Parity with web /settings, laid
// out as grouped cards. Pushed from the header AvatarButton; lives
// outside (tabs) so it presents full-screen with a back affordance.
import { useEffect, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useProfile } from "@/lib/profile-context";
import { useUsage } from "@/lib/usage-context";
import { UnitToggle } from "@/components/settings/unit-toggle";

// Mirrors the API's display-name cap; server is authoritative.
const MAX_DISPLAY_NAME = 60;
const CM_PER_INCH = 2.54;

// Shared by both render paths (loading + loaded) so the dark header
// never flashes to system defaults.
const HEADER_OPTIONS = {
  title: "Settings",
  headerShown: true,
  headerStyle: { backgroundColor: "#0a0a0b" },
  headerTitleStyle: { color: "#fafafa" },
  headerTintColor: "#fafafa",
  headerShadowVisible: false,
} as const;

export default function SettingsScreen() {
  const router = useRouter();
  const { profile, loading, error, update, uploadAvatar, removeAvatar } = useProfile();
  const { usage, refresh: refreshUsage } = useUsage();

  const [name, setName] = useState("");
  const [height, setHeight] = useState(""); // display unit (in or cm)
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  // True once the user edits name/height; blocks the seed effect from
  // clobbering in-progress edits when an unrelated profile mutation
  // (unit toggle, avatar change) returns a fresh profile. Cleared on
  // save so the server-confirmed values re-seed.
  const [dirty, setDirty] = useState(false);

  const heightUnit = profile?.distance_unit === "km" ? "cm" : "in";

  // Seed the form whenever the resolved profile (re)arrives, unless
  // the user has unsaved edits.
  useEffect(() => {
    if (!profile || dirty) return;
    setName(profile.display_name);
    if (profile.height_cm === null) {
      setHeight("");
    } else {
      // Mirror web: one decimal, dropping trailing ".0" so "180" reads cleanly.
      const displayed = heightUnit === "cm" ? profile.height_cm : profile.height_cm / CM_PER_INCH;
      setHeight(String(Math.round(displayed * 10) / 10));
    }
  }, [profile, heightUnit, dirty]);

  useEffect(() => {
    void refreshUsage();
  }, [refreshUsage]);

  async function saveProfile() {
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("Display name is required.");
      return;
    }
    if (trimmed.length > MAX_DISPLAY_NAME) {
      setFormError(`Display name must be ≤ ${MAX_DISPLAY_NAME} characters.`);
      return;
    }
    let height_cm: number | null = null;
    if (height.trim() !== "") {
      const n = Number(height);
      if (!Number.isFinite(n) || n <= 0) {
        setFormError("Enter a valid height, or leave blank to clear.");
        return;
      }
      // Mirror web: round to one decimal to avoid float noise from in→cm.
      const raw = heightUnit === "cm" ? n : n * CM_PER_INCH;
      height_cm = Math.round(raw * 10) / 10;
    }
    setSaving(true);
    setFormError(null);
    try {
      await update({ display_name: trimmed, height_cm });
      setDirty(false); // let the confirmed profile re-seed the form
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // Unit toggles save immediately; surface failures inline instead of
  // letting the rejected promise vanish (the toggle would silently
  // snap back with no explanation).
  function saveUnit(patch: { distance_unit?: "mi" | "km"; weight_unit?: "lb" | "kg" }) {
    setFormError(null);
    update(patch).catch((err) => {
      setFormError(err instanceof Error ? err.message : String(err));
    });
  }

  async function changeAvatar() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setAvatarBusy(true);
    try {
      await uploadAvatar({
        uri: asset.uri,
        mimeType: asset.mimeType ?? "image/jpeg",
        fileName: asset.fileName ?? "avatar.jpg",
      });
    } catch (err) {
      Alert.alert("Avatar", err instanceof Error ? err.message : String(err));
    } finally {
      setAvatarBusy(false);
    }
  }

  function avatarMenu() {
    const doRemove = async () => {
      setAvatarBusy(true);
      try {
        await removeAvatar();
      } catch (err) {
        Alert.alert("Avatar", err instanceof Error ? err.message : String(err));
      } finally {
        setAvatarBusy(false);
      }
    };
    if (Platform.OS === "ios") {
      const hasUpload = Boolean(profile?.avatar_url);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: hasUpload
            ? ["Choose photo", "Remove photo", "Cancel"]
            : ["Choose photo", "Cancel"],
          destructiveButtonIndex: hasUpload ? 1 : undefined,
          cancelButtonIndex: hasUpload ? 2 : 1,
        },
        (i) => {
          if (i === 0) void changeAvatar();
          if (hasUpload && i === 1) void doRemove();
        },
      );
    } else {
      // Android (out of scope this phase): no action sheet — tap goes
      // straight to the picker. Remove-photo is iOS-only for now.
      void changeAvatar();
    }
  }

  function resetCountdown(): string | null {
    if (!usage?.resets_at) return null;
    const ms = Date.parse(usage.resets_at) - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  if (loading && !profile) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={HEADER_OPTIONS} />
        <ActivityIndicator />
      </View>
    );
  }

  const countdown = resetCountdown();

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 px-4 py-4 pb-12">
      <Stack.Screen options={HEADER_OPTIONS} />

      {/* ---- Profile ---- */}
      <Section title="Profile">
        <Pressable
          onPress={avatarMenu}
          disabled={avatarBusy}
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
          className="min-h-11 flex-row items-center gap-3 active:opacity-80"
        >
          <View className="h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-border bg-background">
            {avatarBusy ? (
              <ActivityIndicator />
            ) : profile?.avatar_url ? (
              <Image
                source={{ uri: profile.avatar_url }}
                className="h-14 w-14"
                accessibilityIgnoresInvertColors
              />
            ) : (
              <Text className="text-lg font-semibold text-muted">
                {profile?.display_name?.[0]?.toUpperCase() ?? "?"}
              </Text>
            )}
          </View>
          <View>
            <Text className="text-sm text-foreground">Profile photo</Text>
            <Text className="text-xs text-muted">
              {profile?.avatar_url ? "Tap to change or remove" : "Tap to add"}
            </Text>
          </View>
        </Pressable>

        <Field label="Display name">
          <TextInput
            value={name}
            onChangeText={(v) => {
              setDirty(true);
              setName(v);
            }}
            maxLength={MAX_DISPLAY_NAME}
            autoCapitalize="words"
            editable={!saving}
            className="min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </Field>

        <Field label={`Height (${heightUnit})`}>
          <TextInput
            value={height}
            onChangeText={(v) => {
              setDirty(true);
              setHeight(v);
            }}
            keyboardType="decimal-pad"
            editable={!saving}
            placeholder="Not set"
            placeholderTextColor="#a1a1aa"
            className="min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums text-foreground"
          />
        </Field>

        {(formError ?? error) && (
          <View className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
            <Text className="text-xs text-danger">{formError ?? error}</Text>
          </View>
        )}

        <Pressable
          onPress={saveProfile}
          disabled={saving}
          accessibilityRole="button"
          className="min-h-11 items-center justify-center rounded-md bg-accent px-4 py-2 active:opacity-80 disabled:opacity-50"
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-sm font-medium text-accent-fg">Save</Text>
          )}
        </Pressable>
      </Section>

      {/* ---- Units ---- */}
      <Section title="Units">
        <Field label="Distance">
          <UnitToggle
            options={[
              { value: "mi", label: "Miles" },
              { value: "km", label: "Kilometers" },
            ]}
            value={profile?.distance_unit ?? "mi"}
            disabled={saving}
            onChange={(v) => saveUnit({ distance_unit: v })}
          />
        </Field>
        <Field label="Weight">
          <UnitToggle
            options={[
              { value: "lb", label: "Pounds" },
              { value: "kg", label: "Kilograms" },
            ]}
            value={profile?.weight_unit ?? "lb"}
            disabled={saving}
            onChange={(v) => saveUnit({ weight_unit: v })}
          />
        </Field>
      </Section>

      {/* ---- Content ---- */}
      <Section title="Content">
        <Pressable
          onPress={() => router.push("/exercises")}
          accessibilityRole="button"
          accessibilityLabel="Open exercise catalog"
          className="min-h-11 flex-row items-center justify-between gap-3 active:opacity-80"
        >
          <View>
            <Text className="text-sm text-foreground">Exercise catalog</Text>
            <Text className="text-xs text-muted">Browse and search all exercises</Text>
          </View>
          <Text className="text-muted">›</Text>
        </Pressable>
      </Section>

      {/* ---- Usage ---- */}
      <Section title="Daily AI usage">
        <View className="h-2 overflow-hidden rounded-full bg-border">
          <View
            className={`h-2 rounded-full ${usage?.capped ? "bg-danger" : "bg-accent"}`}
            style={{ width: `${Math.min(100, usage?.percent_used ?? 0)}%` }}
          />
        </View>
        <Text className="text-xs text-muted">
          {usage
            ? `${Math.round(usage.percent_used)}% of today's allowance used` +
              (countdown ? ` · resets in ${countdown}` : "")
            : "Usage unavailable"}
        </Text>
        {usage?.capped && (
          <Text className="text-xs text-danger">
            Daily allowance reached — chat is paused until reset.
          </Text>
        )}
      </Section>

      <Text className="text-center text-xs text-muted">{profile?.email}</Text>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-3 rounded-lg border border-border bg-surface px-4 py-4">
      <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</Text>
      {children}
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-1">
      <Text className="text-xs text-muted">{label}</Text>
      {children}
    </View>
  );
}

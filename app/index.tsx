// Entry route. The only thing it does is decide whether to send the
// user to the login screen or into the tab navigator based on whether
// a token is already in the Keychain. We do this in a route (rather
// than in _layout) so the route table itself doesn't need to be
// re-rendered while we're waiting for SecureStore.
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { getToken } from "@/lib/auth";

export default function Index() {
  // null = haven't checked yet; boolean = result of the SecureStore read.
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    getToken().then((t) => setAuthed(!!t));
  }, []);

  if (authed === null) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#fafafa" />
      </View>
    );
  }
  return <Redirect href={authed ? "/activities" : "/login"} />;
}

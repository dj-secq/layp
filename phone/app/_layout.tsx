import { refreshReminders, startReminders } from "@/notify";
import { PhoneProvider, usePhone } from "@/state/phone";
import { screenChrome } from "@/theme/chrome";
import { useLaypFonts } from "@/theme/fonts";
import { PaperProvider, usePaper } from "@/theme/theme";
import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { AppState } from "react-native";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const fonts = useLaypFonts();
  if (!fonts) return null;
  return (
    <PhoneProvider>
      <PaperProvider>
        <ReminderRefresh />
        <RootStack />
      </PaperProvider>
    </PhoneProvider>
  );
}

function RootStack() {
  const paper = usePaper();
  return (
    <Stack screenOptions={screenChrome(paper)}>
      <Stack.Screen name="index" options={{ title: "Layp" }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="task/[id]" options={{ title: "Task" }} />
      <Stack.Screen name="search" options={{ title: "Search" }} />
      <Stack.Screen
        name="add"
        options={{
          presentation: "formSheet",
          title: "Add",
          sheetGrabberVisible: true,
          sheetAllowedDetents: [0.55, 1],
        }}
      />
    </Stack>
  );
}

/** Refill the queue once the database is ready, whenever that data changes, and when the app becomes active. */
function ReminderRefresh() {
  const phone = usePhone();

  useEffect(() => startReminders(phone.changed), [phone.changed]);

  useEffect(() => {
    if (!phone.ready || phone.bootError) return;
    void refreshReminders();
  }, [phone.ready, phone.bootError, phone.revision]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void refreshReminders();
    });
    return () => subscription.remove();
  }, []);

  return null;
}

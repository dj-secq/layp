import { refreshReminders, startReminders } from "@/notify";
import { PhoneProvider, usePhone } from "@/state/phone";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { AppState, useColorScheme } from "react-native";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <PhoneProvider>
        <ReminderRefresh />
        <Stack screenOptions={{ headerShadowVisible: false }}>
          <Stack.Screen name="index" options={{ title: "Layp" }} />
          <Stack.Screen name="today" options={{ title: "Today" }} />
          <Stack.Screen name="inbox" options={{ title: "Inbox" }} />
          <Stack.Screen name="board" options={{ title: "Board" }} />
          <Stack.Screen name="task/[id]" options={{ title: "Task" }} />
        </Stack>
      </PhoneProvider>
    </ThemeProvider>
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

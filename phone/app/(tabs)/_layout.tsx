import { bodyFamily, fontsReady } from "@/theme/fonts";
import { usePaper } from "@/theme/theme";
import { NativeTabs } from "expo-router/native-tabs";

export default function TabsLayout() {
  const paper = usePaper();
  const label = fontsReady()
    ? { fontFamily: bodyFamily, fontWeight: "400" as const, fontSize: 12 }
    : { fontSize: 12 };
  return (
    <NativeTabs
      tintColor={paper.ink}
      iconColor={{ default: paper.secondary, selected: paper.ink }}
      backgroundColor={paper.grouped}
      indicatorColor={paper.muted}
      rippleColor={paper.border}
      labelStyle={{
        default: { ...label, color: paper.secondary },
        selected: { ...label, color: paper.ink },
      }}
    >
      <NativeTabs.Trigger name="today">
        <NativeTabs.Trigger.Icon md="today" />
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Icon md="inbox" />
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="calendar">
        <NativeTabs.Trigger.Icon md="calendar_month" />
        <NativeTabs.Trigger.Label>Calendar</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="focus">
        <NativeTabs.Trigger.Icon md="timer" />
        <NativeTabs.Trigger.Label>Focus</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Icon md="menu" />
        <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

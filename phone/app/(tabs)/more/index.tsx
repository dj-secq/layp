import { ScreenScroll } from "@/components/screen";
import { usePhone } from "@/state/phone";
import { colors } from "@/theme/colors";
import { usePaper } from "@/theme/theme";
import { Redirect, router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { LaypTitle } from "@/components/layp-title";

const ROWS = [
  { href: "/more/upcoming", label: "Upcoming" },
  { href: "/more/board", label: "Board" },
  { href: "/more/matrix", label: "Matrix" },
  { href: "/more/timeline", label: "Timeline" },
  { href: "/more/month", label: "Month" },
  { href: "/more/year", label: "Year" },
  { href: "/more/trackers", label: "Trackers" },
  { href: "/more/hobbies", label: "Hobbies" },
  { href: "/more/stats", label: "Stats" },
  { href: "/more/lists", label: "Lists" },
  { href: "/more/filters", label: "Filters" },
  { href: "/more/countdowns", label: "Countdowns" },
  { href: "/more/trash", label: "Trash" },
  { href: "/more/archive", label: "Archive" },
  { href: "/more/settings", label: "Settings" },
] as const;

export default function MoreScreen() {
  usePaper();
  const phone = usePhone();
  if (!phone.ready) return null;
  if (phone.bootError) return null;
  if (!phone.hasKey) return <Redirect href="/" />;

  return (
    <ScreenScroll>
      <LaypTitle>More</LaypTitle>
      <View style={{ backgroundColor: colors.grouped, borderRadius: 16, borderCurve: "continuous", paddingHorizontal: 12 }}>
        {ROWS.map((row) => (
          <Pressable
            key={row.href}
            accessibilityRole="button"
            onPress={() => router.push(row.href)}
            style={{ minHeight: 48, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: colors.separator }}
          >
            <Text style={{ color: colors.label, fontSize: 17 }}>{row.label}</Text>
          </Pressable>
        ))}
      </View>
    </ScreenScroll>
  );
}

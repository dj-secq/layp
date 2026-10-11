import { boldFamily, fontsReady } from "./fonts";
import type { Paper } from "./paper";

/** Header, page, and status-bar colors for one paper. Light papers use dark icons. */
export function screenChrome(paper: Paper) {
  const dark = paper.scheme === "dark";
  return {
    headerShadowVisible: false,
    headerStyle: { backgroundColor: paper.background },
    headerTintColor: paper.ink,
    headerTitleStyle: {
      color: paper.ink,
      fontFamily: fontsReady() ? boldFamily : undefined,
      fontSize: 22,
      fontWeight: "400" as const,
    },
    headerUserInterfaceStyle: paper.scheme,
    contentStyle: { backgroundColor: paper.background },
    statusBarStyle: dark ? ("light" as const) : ("dark" as const),
    statusBarBackgroundColor: paper.background,
  };
}

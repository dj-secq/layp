import { useFonts } from "expo-font";

/** Desktop body: Space Grotesk 500. The name matches the file Android loads. */
export const bodyFamily = "SpaceGrotesk_500Medium";
/** Desktop titles: Space Grotesk 700. A separate file so Android does not faux-bold the medium cut. */
export const boldFamily = "SpaceGrotesk_700Bold";
/** Desktop focus clock only. */
export const displayFamily = "ArchivoBlack_400Regular";

let faces = false;

export function fontsReady(): boolean {
  return faces;
}

type Weight = string | number | undefined;

export function isBoldWeight(weight: Weight): boolean {
  if (weight == null || weight === "normal" || weight === "400" || weight === "500") return false;
  if (weight === "bold" || weight === "600" || weight === "700" || weight === "800" || weight === "900") return true;
  return typeof weight === "number" && weight >= 600;
}

/** Load the desktop faces. Returns true once the app can render, even if the load failed. */
export function useLaypFonts(): boolean {
  const [loaded, error] = useFonts({
    [bodyFamily]: require("../../assets/fonts/SpaceGrotesk_500Medium.ttf"),
    [boldFamily]: require("../../assets/fonts/SpaceGrotesk_700Bold.ttf"),
    [displayFamily]: require("../../assets/fonts/ArchivoBlack_400Regular.ttf"),
  });
  if (loaded) faces = true;
  return loaded || error != null;
}

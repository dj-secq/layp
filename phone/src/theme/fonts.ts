import { ArchivoBlack_400Regular } from "@expo-google-fonts/archivo-black";
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";
import { useFonts } from "expo-font";

/** Desktop body: Space Grotesk 500, registered as “Layp Grotesk”. */
export const bodyFamily = "LaypGrotesk";
/** Desktop titles: Space Grotesk 700. A separate file so Android does not faux-bold the medium cut. */
export const boldFamily = "LaypGroteskBold";
/** Desktop focus clock only. */
export const displayFamily = "LaypDisplay";

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
    [bodyFamily]: SpaceGrotesk_500Medium,
    [boldFamily]: SpaceGrotesk_700Bold,
    [displayFamily]: ArchivoBlack_400Regular,
  });
  if (loaded) faces = true;
  return loaded || error != null;
}

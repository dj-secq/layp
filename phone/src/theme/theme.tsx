import { usePhone } from "@/state/phone";
import { setBackgroundColorAsync } from "expo-system-ui";
import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { Appearance, useColorScheme } from "react-native";
import { loadSettings, type PhoneSettings } from "../db/settings";
import { paint } from "./colors";
import { papers, type Paper, type ThemeName } from "./paper";

const defaultSettings: PhoneSettings = {
  theme: "light",
  weekStart: "monday",
  pomoWorkMinutes: 25,
  pomoBreakMinutes: 5,
  pomoSoundWork: "bell",
  pomoSoundBreak: "bell",
  clock: "12",
  quickSnippets: [],
};

const PaperContext = createContext<{ paper: Paper; settings: PhoneSettings }>({
  paper: papers.light,
  settings: defaultSettings,
});

export function PaperProvider({ children }: { children: ReactNode }) {
  const phone = usePhone();
  const [settings, setSettings] = useState<PhoneSettings>(defaultSettings);

  useEffect(() => {
    if (!phone.ready) return;
    let cancel = false;
    void loadSettings()
      .then((next) => {
        if (!cancel) setSettings(next);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.revision]);

  const paper = papers[settings.theme];

  useEffect(() => {
    if (Appearance.getColorScheme() !== paper.scheme) Appearance.setColorScheme(paper.scheme);
    void setBackgroundColorAsync(paper.background).catch(() => undefined);
  }, [paper.scheme, paper.background]);

  return <PaperContext value={{ paper, settings }}>{children}</PaperContext>;
}

/** Subscribe to the paper theme and paint the shared color object for this render. */
export function usePaper(): Paper {
  useColorScheme();
  const paper = use(PaperContext).paper;
  paint(paper);
  return paper;
}

export function usePhoneSettings(): PhoneSettings {
  useColorScheme();
  return use(PaperContext).settings;
}

export type { ThemeName };

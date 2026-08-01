import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isTauri } from "@tauri-apps/api/core";

const THEME_STORAGE_KEY = "translator.theme";
const THEME_COLOR_STORAGE_KEY = "translator.themeColor";
const RADIUS_STORAGE_KEY = "translator.radius";

export type Theme = "auto" | "light" | "dark";
export type ThemeColorPreset =
  | "neutral"
  | "blue"
  | "green"
  | "violet"
  | "orange";
export type CustomThemeColor = `#${string}`;
export type ThemeColor = ThemeColorPreset | CustomThemeColor;
export type RadiusPreset =
  | "square"
  | "compact"
  | "default"
  | "rounded"
  | "soft";

export const DEFAULT_CUSTOM_THEME_COLOR = "#3b82f6";

export function isCustomThemeColor(value: string): value is CustomThemeColor {
  return /^#[0-9a-f]{6}$/iu.test(value);
}

export function isThemeColor(value: string): value is ThemeColor {
  return (
    ["neutral", "blue", "green", "violet", "orange"].includes(value) ||
    isCustomThemeColor(value)
  );
}

function readThemeColor(): ThemeColor {
  const stored = window.localStorage.getItem(THEME_COLOR_STORAGE_KEY);
  return stored && isThemeColor(stored) ? stored : "green";
}

function getThemeColorForeground(color: CustomThemeColor) {
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(color.slice(offset + 1, offset + 3), 16) / 255,
  );
  const luminance = channels.reduce((total, channel, index) => {
    const linear =
      channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    return total + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
  return luminance > 0.55 ? "#0f172a" : "#ffffff";
}

function readTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "auto" || stored === "light" || stored === "dark") {
    return stored;
  }
  return "auto";
}

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  themeColor: ThemeColor;
  setThemeColor: (themeColor: ThemeColor) => void;
  radius: RadiusPreset;
  setRadius: (radius: RadiusPreset) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [themeColor, setThemeColorState] = useState<ThemeColor>(readThemeColor);
  const [radius, setRadiusState] = useState<RadiusPreset>(() => {
    const stored = window.localStorage.getItem(RADIUS_STORAGE_KEY);
    return stored === "square" ||
      stored === "compact" ||
      stored === "rounded" ||
      stored === "soft"
      ? stored
      : "default";
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolvedTheme =
        theme === "auto" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.classList.toggle(
        "dark",
        resolvedTheme === "dark",
      );
      document.documentElement.style.colorScheme = resolvedTheme;
    };

    applyTheme();
    if (theme === "auto") {
      media.addEventListener("change", applyTheme);
      return () => media.removeEventListener("change", applyTheme);
    }
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (isCustomThemeColor(themeColor)) {
      root.dataset.themeColor = "custom";
      root.style.setProperty("--custom-theme-color", themeColor);
      root.style.setProperty(
        "--custom-theme-color-foreground",
        getThemeColorForeground(themeColor),
      );
      return;
    }
    root.dataset.themeColor = themeColor;
    root.style.removeProperty("--custom-theme-color");
    root.style.removeProperty("--custom-theme-color-foreground");
  }, [themeColor]);

  useEffect(() => {
    const values: Record<RadiusPreset, string> = {
      square: "0rem",
      compact: "0.375rem",
      default: "0.625rem",
      rounded: "0.875rem",
      soft: "1.25rem",
    };
    document.documentElement.style.setProperty("--radius", values[radius]);
  }, [radius]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      themeColor,
      radius,
      setTheme(nextTheme) {
        if (!isTauri()) {
          window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        }
        setThemeState(nextTheme);
      },
      setThemeColor(nextThemeColor) {
        if (!isTauri()) {
          window.localStorage.setItem(
            THEME_COLOR_STORAGE_KEY,
            nextThemeColor,
          );
        }
        setThemeColorState(nextThemeColor);
      },
      setRadius(nextRadius) {
        if (!isTauri()) {
          window.localStorage.setItem(RADIUS_STORAGE_KEY, nextRadius);
        }
        setRadiusState(nextRadius);
      },
    }),
    [radius, theme, themeColor],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}

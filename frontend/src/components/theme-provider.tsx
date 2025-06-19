import React, { createContext, useContext, useEffect, useState } from "react";
import type { Config, ThemeMode, ApiResponse } from "shared/types";

type ThemeProviderProps = {
  children: React.ReactNode;
};

type ThemeProviderState = {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  loadThemeFromConfig: () => Promise<void>;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  loadThemeFromConfig: async () => {},
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>("system");

  // Load theme from backend config
  const loadThemeFromConfig = async () => {
    try {
      const response = await fetch("/api/config");
      const data: ApiResponse<Config> = await response.json();
      
      if (data.success && data.data) {
        setThemeState(data.data.theme);
      }
    } catch (err) {
      console.error("Error loading theme from config:", err);
    }
  };

  // Load theme on mount
  useEffect(() => {
    loadThemeFromConfig();
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";

      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  const setTheme = (newTheme: ThemeMode) => {
    setThemeState(newTheme);
  };

  const value = {
    theme,
    setTheme,
    loadThemeFromConfig,
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
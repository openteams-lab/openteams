import React, { createContext, useContext, useEffect, useState } from 'react';
import { ThemeMode } from 'shared/types';

type ThemeProviderProps = {
  children: React.ReactNode;
  initialTheme?: ThemeMode;
};

type ThemeProviderState = {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
};

const normalizeThemeMode = (theme: ThemeMode): ThemeMode =>
  theme === ThemeMode.DARK || theme === ThemeMode.SYSTEM
    ? ThemeMode.LIGHT
    : theme;

const initialState: ThemeProviderState = {
  theme: ThemeMode.LIGHT,
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  initialTheme = ThemeMode.LIGHT,
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>(
    normalizeThemeMode(initialTheme)
  );

  useEffect(() => {
    setThemeState(normalizeThemeMode(initialTheme));
  }, [initialTheme]);

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove('light', 'dark');
    root.classList.add('light');
  }, [theme]);

  const setTheme = (newTheme: ThemeMode) => {
    setThemeState(normalizeThemeMode(newTheme));
  };

  const value = {
    theme,
    setTheme,
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
    throw new Error('useTheme must be used within a ThemeProvider');

  return context;
};

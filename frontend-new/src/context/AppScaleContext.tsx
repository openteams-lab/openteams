import { createContext, useContext } from "react";

export type AppScaleContextValue = {
  enabled: boolean;
  scale: number;
  fontScale: number;
  viewportWidth: number;
  viewportHeight: number;
  frameWidth: number;
  frameHeight: number;
  portalRoot: HTMLElement | null;
};

export const defaultAppScaleContext: AppScaleContextValue = {
  enabled: false,
  scale: 1,
  fontScale: 1,
  viewportWidth: 0,
  viewportHeight: 0,
  frameWidth: 0,
  frameHeight: 0,
  portalRoot: null,
};

export const AppScaleContext = createContext<AppScaleContextValue>(
  defaultAppScaleContext,
);

export const useAppScale = () => useContext(AppScaleContext);

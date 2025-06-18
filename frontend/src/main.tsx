import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ClickToComponent } from "click-to-react-component";
import { ThemeProvider } from "@/components/theme-provider";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vibe-kanban-ui-theme">
      <ClickToComponent />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);

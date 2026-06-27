import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installAppViewportHeightSync } from "./appViewport.js";
import { App } from "./App.js";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

installAppViewportHeightSync(window, document.documentElement);

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

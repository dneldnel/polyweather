import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppRouter } from "./router";
import "./globals.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
);

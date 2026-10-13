import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AssistantQuickApp from "./components/AssistantQuickApp";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AssistantQuickApp />
  </StrictMode>
);

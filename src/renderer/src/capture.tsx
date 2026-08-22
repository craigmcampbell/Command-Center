import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CaptureApp from "./components/CaptureApp";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CaptureApp />
  </StrictMode>
);

import { createRoot } from "react-dom/client";
import { App } from "./ui/App.js";
import "./style.css";
import "./ui/trial-experience.css";
import "./ui/pixel-world.css";
import "./ui/duo-guide.css";
import "./ui/v2-surface.css";
import "./ui/v2-tokens.css";
import "./ui/v2-card.css";
import "./ui/v2-home-revamp.css";
import "./ui/v2-structure-ring.css";
import "./ui/v2-fixed-page.css";
import "./ui/v2-feedback.css";
import "./ui/v2-calendar-picker.css";
import "./ui/v2-detail-visual.css";
import "./ui/v2-savings-room.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing.");

const illustrativePreview =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get("illustrative") === "1";

if (illustrativePreview) {
  const { createIllustrativeServices } = await import("./ui/themes/illustrative-services.js");
  createRoot(root).render(<App services={createIllustrativeServices()} />);
} else {
  createRoot(root).render(<App />);
}

import { createRoot } from "react-dom/client";
import { App } from "./ui/App.js";
import "./style.css";
import "./ui/trial-experience.css";
import "./ui/pixel-world.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing.");
createRoot(root).render(<App />);

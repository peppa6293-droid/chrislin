import React from "react";
import { createRoot } from "react-dom/client";
import { V4AcceptanceApp } from "./ui/V4AcceptanceApp.js";
import "./ui/v4-acceptance.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing V4 acceptance root element.");
createRoot(root).render(
  <React.StrictMode>
    <V4AcceptanceApp />
  </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App";
import ReminderSurface from "./components/ReminderSurface";
import "./App.css";

const surface = new URLSearchParams(window.location.search).get("surface");
const content = surface === "reminder"
  ? <ReminderSurface kind="reminder" />
  : surface === "dim"
    ? <ReminderSurface kind="dim" />
    : <App />;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {content}
    </ThemeProvider>
  </React.StrictMode>,
);

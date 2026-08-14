import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css"; // Hoặc ./index.css nếu bạn để css ở đó

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
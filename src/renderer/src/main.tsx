import "@fontsource/fredoka/500.css";
import "@fontsource/fredoka/600.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "./styles/global.css";

import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import {
  windowLabelFromSearch,
  type WindowLabel,
} from "../../shared/windowLabel";
import PongWindow from "./windows/pong/PongWindow";
import CheckinWindow from "./windows/checkin/CheckinWindow";
import MainWindow from "./windows/main/MainWindow";

const screens: Record<WindowLabel, ComponentType> = {
  pong: PongWindow,
  checkin: CheckinWindow,
  main: MainWindow,
};

const label = windowLabelFromSearch(window.location.search);
document.documentElement.dataset.window = label;
const Screen = screens[label];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Screen />
  </StrictMode>,
);

/**
 * The extension's options page (PRD-extension §5.4): which port the CRT server is on, when it is
 * not 4400. The host is always this machine (N-43).
 */
import { DEFAULT_SERVER, loopbackServer, SERVER_KEY, serverForPort } from "./wire.js";

const input = document.getElementById("port") as HTMLInputElement;
const note = document.getElementById("note") as HTMLElement;

void chrome.storage.local.get(SERVER_KEY).then((stored) => {
  input.value = new URL(loopbackServer(stored[SERVER_KEY]) ?? DEFAULT_SERVER).port || "80";
});

input.addEventListener("change", () => {
  const server = serverForPort(input.value);
  if (!server) {
    note.textContent = "A port is a number from 1 to 65535.";
    return;
  }
  void chrome.storage.local.set({ [SERVER_KEY]: server }).then(() => {
    note.textContent = `Saved. CRT pages talk to ${server} from their next load.`;
  });
});

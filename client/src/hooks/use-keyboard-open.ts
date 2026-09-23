import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

/**
 * True while the on-screen keyboard is up.
 *
 * Native (Capacitor): Keyboard plugin events. With `resize: "native"` the
 * webview itself shrinks, so window.innerHeight and visualViewport shrink
 * together and the viewport-diff heuristic below never fires on iOS.
 * Web / PWA: the visual viewport shrinking by more than 120px.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      const handles = [
        Keyboard.addListener("keyboardWillShow", () => setOpen(true)),
        Keyboard.addListener("keyboardWillHide", () => setOpen(false)),
      ];
      return () => { handles.forEach((h) => h.then((l) => l.remove()).catch(() => {})); };
    }

    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setOpen(window.innerHeight - vv.height > 120);
    vv.addEventListener("resize", onResize);
    onResize();
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  return open;
}

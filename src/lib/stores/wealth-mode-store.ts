"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type WealthMode = "consultor" | "cliente";

interface WealthModeState {
  mode: WealthMode;
  setMode: (mode: WealthMode) => void;
}

export const useWealthMode = create<WealthModeState>()(
  persist(
    (set) => ({
      mode: "consultor",
      setMode: (mode) => set({ mode }),
    }),
    {
      name: "wealth-mode-storage",
    }
  )
);

"use client";

// Estado do painel da Central de Ajuda. Antes o gatilho era um FAB flutuante "?" (canto inferior);
// o CEO pediu que a Ajuda saísse do flutuante para o cabeçalho. O painel (AjudaWidget) segue montado
// no layout; quem o abre agora é o ícone de Ajuda do TopNav — este store liga os dois sem prop-drilling.
import { create } from "zustand";

interface AjudaState {
  aberto: boolean;
  abrir: () => void;
  fechar: () => void;
}

export const useAjuda = create<AjudaState>((set) => ({
  aberto: false,
  abrir: () => set({ aberto: true }),
  fechar: () => set({ aberto: false }),
}));

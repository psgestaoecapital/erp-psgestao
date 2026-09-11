"use client";
// Guarda de recovery: se o usuário chegou por um link de redefinição de senha (evento
// PASSWORD_RECOVERY do Supabase) e ainda NÃO trocou a senha, não pode navegar no dashboard —
// é mandado para /auth/nova-senha. A flag é limpa quando a troca conclui (na tela de nova senha).
// Vida curta: se o 'recovery pendente' passar de 15 min sem concluir, derruba a sessão e manda pro
// login com aviso (a tela /auth/nova-senha mostra "link expirado" quando não há mais sessão).
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const FLAG = "pw_recovery_pending";
const STARTED = "pw_recovery_started";
const TTL_MS = 15 * 60 * 1000;

export default function RecoveryGuard() {
  const router = useRouter();
  useEffect(() => {
    const get = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
    const clear = () => { try { sessionStorage.removeItem(FLAG); sessionStorage.removeItem(STARTED); } catch { /* */ } };

    if (get(FLAG) === "1") {
      const started = Number(get(STARTED)) || 0;
      if (started && Date.now() - started > TTL_MS) {
        // expirou sem concluir → não deixa a porta aberta: derruba a sessão de recovery
        (async () => { try { await supabase.auth.signOut(); } catch { /* */ } clear(); router.replace("/auth/nova-senha"); })();
      } else {
        router.replace("/auth/nova-senha");
      }
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        try { sessionStorage.setItem(FLAG, "1"); if (!sessionStorage.getItem(STARTED)) sessionStorage.setItem(STARTED, String(Date.now())); } catch { /* */ }
        router.replace("/auth/nova-senha");
      }
    });
    return () => subscription.unsubscribe();
  }, [router]);
  return null;
}

"use client";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase";

/**
 * Hook para filtrar queries por empresa/grupo/consolidado.
 * Lê ps_empresa_sel do localStorage e escuta mudanças.
 * 
 * Uso:
 * ```tsx
 * const { companyIds, selInfo, loading, sel } = useCompanyIds();
 * 
 * useEffect(() => {
 *   if (companyIds.length > 0) {
 *     supabase.from('erp_lancamentos').select('*').in('company_id', companyIds).then(...)
 *   }
 * }, [companyIds]);
 * ```
 */
export function useCompanyIds() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [sel, setSel] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("ps_empresa_sel") || "consolidado";
    }
    return "consolidado";
  });
  const [loading, setLoading] = useState(true);

  // Carrega empresas e grupos
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: up } = await supabase.from("users").select("role").eq("id", user.id).single();

      const { data: grps } = await supabase.from("company_groups").select("*").order("nome");
      setGroups(grps || []);

      let comps: any[] = [];
      if (up?.role === "adm" || up?.role === "acesso_total" || up?.role === "adm_investimentos") {
        const { data } = await supabase.from("companies").select("*").order("nome_fantasia");
        comps = data || [];
      } else {
        const { data } = await supabase
          .from("user_companies")
          .select("companies(*)")
          .eq("user_id", user.id);
        comps = (data || []).map((uc: any) => uc.companies).filter(Boolean);
      }
      setCompanies(comps);
      setLoading(false);
    })();
  }, []);

  // Escuta mudanças no localStorage (quando usuário muda empresa no seletor do layout)
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    // Polling a cada 500ms (evento storage só dispara em outras abas)
    const interval = setInterval(() => {
      const saved = localStorage.getItem("ps_empresa_sel") || "consolidado";
      if (saved !== sel) setSel(saved);
    }, 500);

    return () => clearInterval(interval);
  }, [sel]);

  // FIX-VAZAMENTO-JORDANA (07/07 · defesa em profundidade):
  // Valida sel UUID contra companies do usuario. Se sel = <UUID> mas UUID
  // nao pertence ao usuario (localStorage stale, empresa removida, admin
  // que trocou de conta), NAO virar selInfo.tipo='empresa' fantasma.
  // Sem isso, telas operacionais podem receber companyIdUnico invalido e
  // renderizar vazio ao inves de detectar "empresa desconhecida".
  const selValido = useMemo<string>(() => {
    if (!companies.length) return sel; // ainda carregando: preserva pra evitar flicker
    if (sel === "consolidado") return "consolidado";
    if (sel.startsWith("group_")) return sel;
    return companies.some((c) => c.id === sel) ? sel : "consolidado";
  }, [sel, companies]);

  // Resolve a seleção atual em array de company_ids.
  // useMemo pra manter a MESMA referencia quando o conteudo nao muda —
  // consumidores que fazem useEffect([companyIds]) nao entrariam em loop
  // de fetch (bug historico: array novo a cada render disparava effect
  // repetido, ate ERR_INSUFFICIENT_RESOURCES).
  const companyIds = useMemo<string[]>(() => {
    if (selValido === "consolidado") return companies.map(c => c.id);
    if (selValido.startsWith("group_")) {
      const gid = selValido.replace("group_", "");
      return companies.filter(c => c.group_id === gid).map(c => c.id);
    }
    if (selValido) return [selValido];
    return [];
  }, [companies, selValido]);

  // Info descritiva
  let selInfo: { tipo: "consolidado" | "grupo" | "empresa"; nome: string; count: number; isGroup: boolean };
  if (selValido === "consolidado") {
    selInfo = { tipo: "consolidado", nome: "Todas as Empresas", count: companies.length, isGroup: true };
  } else if (selValido.startsWith("group_")) {
    const gid = selValido.replace("group_", "");
    const grp = groups.find(g => g.id === gid);
    const emps = companies.filter(c => c.group_id === gid);
    selInfo = { tipo: "grupo", nome: grp?.nome || "Grupo", count: emps.length, isGroup: true };
  } else {
    const c = companies.find(c => c.id === selValido);
    selInfo = {
      tipo: "empresa",
      nome: c?.nome_fantasia || c?.razao_social || "",
      count: 1,
      isGroup: false
    };
  }

  // sel exposto e o VALIDADO — consumidores que fazem companyIdUnico=sel
  // ganham a validacao automaticamente sem breaking change.
  return { companyIds, selInfo, loading, sel: selValido, companies, groups };
}

/**
 * Helper síncrono (sem hooks) pra uso em handlers/callbacks.
 * Recebe companies e groups já carregados e resolve a seleção em ids.
 */
export function resolveCompanyIds(sel: string, companies: any[], groups: any[] = []): string[] {
  if (sel === "consolidado") return companies.map(c => c.id);
  if (sel.startsWith("group_")) {
    const gid = sel.replace("group_", "");
    return companies.filter(c => c.group_id === gid).map(c => c.id);
  }
  return sel ? [sel] : [];
}

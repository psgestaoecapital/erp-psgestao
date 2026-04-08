"use client";
import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/lib/supabase";

// ══════════════════════════════════════════════════════════
// CONTEXTO DE SEGURANÇA CENTRALIZADO
// Todas as páginas usam este contexto.
// Nenhuma página carrega empresas por conta própria.
// Um único ponto de verificação = impossível esquecer.
// ══════════════════════════════════════════════════════════

interface AuthContextType {
  user: any | null;
  userId: string;
  role: string;
  isAdmin: boolean;
  companies: any[];
  companyIds: string[];
  groups: any[];
  loading: boolean;
  // Retorna true se o usuário pode acessar essa empresa
  canAccess: (companyId: string) => boolean;
  // Recarrega dados (após vincular nova empresa, etc.)
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null, userId: "", role: "", isAdmin: false,
  companies: [], companyIds: [], groups: [], loading: true,
  canAccess: () => false, refresh: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  const [companies, setCompanies] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const isAdmin = role === "adm";
  const companyIds = companies.map(c => c.id);

  const canAccess = (companyId: string): boolean => {
    if (isAdmin) return true;
    return companyIds.includes(companyId);
  };

  const loadAuth = async () => {
    try {
      // 1. Verificar autenticação
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        setLoading(false);
        return;
      }
      setUser(authUser);
      setUserId(authUser.id);

      // 2. Carregar role do usuário
      const { data: profile } = await supabase
        .from("users")
        .select("role")
        .eq("id", authUser.id)
        .single();
      
      const userRole = profile?.role || "visualizador";
      setRole(userRole);

      // 3. Carregar grupos
      const { data: grps } = await supabase
        .from("company_groups")
        .select("*")
        .order("nome");
      setGroups(grps || []);

      // 4. Carregar empresas autorizadas
      if (userRole === "adm") {
        // Admin vê TUDO
        const { data } = await supabase
          .from("companies")
          .select("*")
          .order("created_at");
        setCompanies(data || []);
      } else {
        // Outros roles: APENAS user_companies
        const { data: uc } = await supabase
          .from("user_companies")
          .select("company_id, companies(*)")
          .eq("user_id", authUser.id);
        
        const comps = (uc || [])
          .map((u: any) => u.companies)
          .filter(Boolean);
        setCompanies(comps);
      }
    } catch (error) {
      console.error("Auth error:", error);
    }
    setLoading(false);
  };

  const refresh = async () => {
    setLoading(true);
    await loadAuth();
  };

  useEffect(() => {
    loadAuth();

    // Escutar mudanças de auth (login/logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      loadAuth();
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{
      user, userId, role, isAdmin,
      companies, companyIds, groups, loading,
      canAccess, refresh,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

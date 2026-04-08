import { supabase } from './supabase'

// Retorna as empresas que o usuário tem acesso
// Admin (role='adm') → todas as empresas
// Outros → apenas empresas em user_companies
export async function getAuthorizedCompanies(): Promise<{ companies: any[]; role: string; userId: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { companies: [], role: '', userId: '' };

  const { data: up } = await supabase.from("users").select("role").eq("id", user.id).single();
  const role = up?.role || 'visualizador';

  if (role === 'adm') {
    // Admin vê TODAS as empresas
    const { data } = await supabase.from("companies").select("*").order("created_at");
    return { companies: data || [], role, userId: user.id };
  }

  // Outros roles: APENAS empresas vinculadas via user_companies
  const { data: uc } = await supabase.from("user_companies")
    .select("company_id, companies(*)")
    .eq("user_id", user.id);

  const companies = (uc || [])
    .map((u: any) => u.companies)
    .filter(Boolean);

  return { companies, role, userId: user.id };
}

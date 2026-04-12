import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface PermissionResult {
  allowed: boolean;
  pode_ver: boolean;
  pode_editar: boolean;
  pode_excluir: boolean;
  pode_exportar: boolean;
  reason?: string;
}

/**
 * Verifica se um nível de acesso tem permissão para um módulo específico
 */
export async function checkPermission(nivel: string, moduloId: string): Promise<PermissionResult> {
  const denied: PermissionResult = { allowed: false, pode_ver: false, pode_editar: false, pode_excluir: false, pode_exportar: false };

  if (!nivel || !moduloId) return { ...denied, reason: 'Nivel ou modulo nao informado' };

  const { data, error } = await supabase
    .from('permissoes_nivel')
    .select('pode_ver, pode_editar, pode_excluir, pode_exportar')
    .eq('nivel', nivel.toLowerCase())
    .eq('modulo_id', moduloId)
    .single();

  if (error || !data) return { ...denied, reason: 'Permissao nao encontrada para ' + nivel + ' / ' + moduloId };

  return {
    allowed: data.pode_ver === true,
    pode_ver: data.pode_ver || false,
    pode_editar: data.pode_editar || false,
    pode_excluir: data.pode_excluir || false,
    pode_exportar: data.pode_exportar || false,
  };
}

/**
 * Retorna todos os módulos que um nível pode acessar
 */
export async function getModulosPermitidos(nivel: string) {
  const { data, error } = await supabase
    .from('permissoes_nivel')
    .select('modulo_id, pode_ver, pode_editar, pode_excluir, pode_exportar, modulos_sistema(nome, grupo, icone, rota, ordem)')
    .eq('nivel', nivel.toLowerCase())
    .eq('pode_ver', true)
    .order('modulo_id');

  if (error) return [];
  return (data || []).sort((a: any, b: any) => (a.modulos_sistema?.ordem || 0) - (b.modulos_sistema?.ordem || 0));
}

/**
 * Retorna módulos liberados por plano de licença
 */
export async function getModulosPorPlano(planoId: string) {
  const { data, error } = await supabase
    .from('planos_modulos')
    .select('modulo_id, modulos_sistema(nome, grupo, icone, rota)')
    .eq('plano_id', planoId);

  if (error) return [];
  return data || [];
}

/**
 * Verifica permissão combinada: nível + plano
 * O usuário precisa ter permissão no nível E o módulo precisa estar no plano
 */
export async function checkFullPermission(nivel: string, moduloId: string, planoId?: string): Promise<PermissionResult> {
  // Administrador sempre passa
  if (nivel.toLowerCase() === 'administrador') {
    return { allowed: true, pode_ver: true, pode_editar: true, pode_excluir: true, pode_exportar: true };
  }

  // Check nível
  const nivelPerm = await checkPermission(nivel, moduloId);
  if (!nivelPerm.allowed) return nivelPerm;

  // Se tem plano, verificar se módulo está liberado
  if (planoId) {
    const { data } = await supabase
      .from('planos_modulos')
      .select('id')
      .eq('plano_id', planoId)
      .eq('modulo_id', moduloId)
      .single();

    if (!data) {
      return { ...nivelPerm, allowed: false, reason: 'Modulo nao incluso no plano ' + planoId };
    }
  }

  return nivelPerm;
}

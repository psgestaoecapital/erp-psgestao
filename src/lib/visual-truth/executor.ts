// src/lib/visual-truth/executor.ts
// Executor de regras Visual Truth — chamado pelo Playwright apos captura.
//
// Para cada regra ativa em visual_audit_rules vinculada ao screen_id:
//  1. Extrai valor da UI via CSS selector (Playwright locator)
//  2. Resolve valor esperado via switch hardcoded (Caminho A — sem dynamic SQL)
//  3. Compara com tolerance_pct da regra
//  4. Insere alerta em visual_truth_alerts se divergir
//
// Caminho A escolhido em 12/05/2026 (CEO Gilberto): switch TypeScript sem
// dynamic SQL. Adicionar regra nova exige PR com case extra (auditavel).
// Regras com rule.id fora do switch sao puladas com log warning — NAO caem
// em dynamic SQL para evitar superficie de injection.

import type { Page } from 'playwright-core';
import type { SupabaseClient } from '@supabase/supabase-js';

export type VisualAuditRule = {
  id: string;
  screen_id: string;
  rule_name: string;
  ui_css_selector: string;
  comparison_type: string;
  tolerance_pct: string | number | null;
  severity: string | null;
};

export type VisualTruthResult = {
  regras_executadas: number;
  alertas_inseridos: number;
  regras_puladas: number;
  detalhes: Array<{
    rule_id: string;
    status: 'ok' | 'divergiu' | 'pulou' | 'erro';
    expected?: number;
    found?: number;
    diff_pct?: number;
    motivo?: string;
  }>;
};

// Switch das regras conhecidas (Caminho A). Cada entrada usa Supabase JS
// client com filtros parametrizados — zero SQL textual em runtime.
async function fetchExpectedValue(
  ruleId: string,
  supabase: SupabaseClient,
): Promise<number | null> {
  switch (ruleId) {
    case 'R.admin.total_empresas': {
      const { count, error } = await supabase
        .from('companies')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
      if (error) throw error;
      return count ?? null;
    }
    case 'R.compliance.total_funcionarios': {
      const { count, error } = await supabase
        .from('compliance_funcionarios')
        .select('*', { count: 'exact', head: true })
        .eq('ativo', true);
      if (error) throw error;
      return count ?? null;
    }
    case 'R.contratos.mrr_total': {
      const { data, error } = await supabase
        .from('tenant_subscriptions')
        .select('monthly_price_brl')
        .eq('status', 'active');
      if (error) throw error;
      const sum = (data ?? []).reduce(
        (acc, r: { monthly_price_brl: number | string | null }) =>
          acc + Number(r.monthly_price_brl ?? 0),
        0,
      );
      return Math.round(sum);
    }
    default:
      return null; // sinaliza "fora do switch" para o caller
  }
}

function parseUiNumber(text: string): number {
  // UI pode renderizar "R$ 10.500,00", "15", "1.337", etc.
  // Estrategia: remove tudo que nao for digito/sinal/separador, normaliza pt-BR.
  const cleaned = text.replace(/[^\d,.\-]/g, '');
  // Heuristica pt-BR: se tem virgula, virgula = decimal e ponto = milhar.
  // Se nao tem virgula, ponto pode ser decimal OU milhar — assumimos milhar
  // (mais comum em UI de "totais") e descartamos.
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(/\./g, '');
  const n = parseFloat(normalized);
  return isNaN(n) ? NaN : n;
}

export async function executarVisualTruthRules(
  page: Page,
  screenId: string,
  rota: string,
  supabase: SupabaseClient,
): Promise<VisualTruthResult> {
  const out: VisualTruthResult = {
    regras_executadas: 0,
    alertas_inseridos: 0,
    regras_puladas: 0,
    detalhes: [],
  };

  // Buscar regras ativas para esta screen
  const { data: rules, error: errRules } = await supabase
    .from('visual_audit_rules')
    .select('id, screen_id, rule_name, ui_css_selector, comparison_type, tolerance_pct, severity')
    .eq('screen_id', screenId)
    .eq('ativo', true);

  if (errRules) {
    console.error('[visual-truth] erro buscando regras:', errRules.message);
    return out;
  }

  if (!rules || rules.length === 0) {
    return out;
  }

  for (const rule of rules as VisualAuditRule[]) {
    try {
      // 1. Valor esperado (switch hardcoded)
      const expected = await fetchExpectedValue(rule.id, supabase);
      if (expected === null) {
        console.warn(`[visual-truth] regra ${rule.id} fora do switch — skip (Caminho A)`);
        out.regras_puladas++;
        out.detalhes.push({ rule_id: rule.id, status: 'pulou', motivo: 'fora_do_switch' });
        continue;
      }

      // 2. Valor da UI via CSS selector
      const locator = page.locator(rule.ui_css_selector).first();
      const uiText = (await locator.textContent({ timeout: 5000 }))?.trim() ?? '';
      const found = parseUiNumber(uiText);

      if (isNaN(found)) {
        console.warn(`[visual-truth] regra ${rule.id}: nao parseou "${uiText}"`);
        out.regras_executadas++;
        out.detalhes.push({
          rule_id: rule.id,
          status: 'erro',
          expected,
          motivo: `parse_falhou: "${uiText}"`,
        });
        continue;
      }

      out.regras_executadas++;

      // 3. Compara com tolerance
      const tolerance = Number(rule.tolerance_pct ?? 0);
      const denom = Math.abs(expected) > 0 ? Math.abs(expected) : 1;
      const diffPct = (Math.abs(found - expected) / denom) * 100;
      const divergiu = diffPct > tolerance;

      if (!divergiu) {
        out.detalhes.push({
          rule_id: rule.id,
          status: 'ok',
          expected,
          found,
          diff_pct: diffPct,
        });
        continue;
      }

      // 4. Insere alerta
      const { error: errInsert } = await supabase.from('visual_truth_alerts').insert({
        rule_id: rule.id,
        screen_id: screenId,
        rota,
        expected_value: String(expected),
        found_value: String(found),
        delta_absoluto: Math.abs(found - expected),
        delta_pct: diffPct,
        severity: rule.severity ?? 'warn',
        status: 'novo',
        detected_at: new Date().toISOString(),
        observacao: `UI=${found} vs DB=${expected} (tolerance=${tolerance}%)`,
      });

      if (errInsert) {
        console.error(`[visual-truth] falha insert alerta ${rule.id}:`, errInsert.message);
        out.detalhes.push({
          rule_id: rule.id,
          status: 'erro',
          expected,
          found,
          diff_pct: diffPct,
          motivo: `insert_falhou: ${errInsert.message}`,
        });
        continue;
      }

      out.alertas_inseridos++;
      out.detalhes.push({
        rule_id: rule.id,
        status: 'divergiu',
        expected,
        found,
        diff_pct: diffPct,
      });

      console.log(
        `[visual-truth] DIVERGENCIA ${rule.id}: UI=${found} vs DB=${expected} (${diffPct.toFixed(2)}%)`,
      );
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      console.error(`[visual-truth] erro regra ${rule.id}:`, motivo);
      out.regras_executadas++;
      out.detalhes.push({ rule_id: rule.id, status: 'erro', motivo });
    }
  }

  return out;
}

-- Hub · Oportunidades: contagem de anexos por card + "?" (RD-95) do alerta de outlier/duplicata e do selo de anexos.
-- Faixa desenvolvedor_4_g (segundos 52). Fecha resíduos da auditoria FC da /oportunidades (auditor 27/10):
--   (1) badge de anexo no card do kanban (hoje só no form/detalhe);
--   (2) alerta não-bloqueante de duplicata/valor-outlier.
-- ADITIVA: função NOVA, somente leitura (não grava), SECURITY DEFINER com guarda por empresa + REVOKE anon.

-- Contagem de anexos vivos por oportunidade da empresa (mesma guarda de fn_crm_orcamento_do_card).
-- Só leitura: não entra na régua de "função que grava" (Regra 4 do check-fn-guards).
CREATE OR REPLACE FUNCTION public.fn_crm_anexos_contagem(p_company_id uuid)
 RETURNS TABLE(oportunidade_id uuid, anexos integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT a.oportunidade_id, count(*)::int
    FROM erp_crm_anexo a
   WHERE a.oportunidade_id IS NOT NULL
     AND a.deleted_at IS NULL
     AND a.company_id = p_company_id
     AND a.company_id IN (SELECT get_user_company_ids())
   GROUP BY a.oportunidade_id;
$function$;

REVOKE ALL ON FUNCTION public.fn_crm_anexos_contagem(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_anexos_contagem(uuid) TO authenticated;

-- "?" dos novos indicadores (RD-95)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.oportunidades.card_anexos', 'Oportunidades', 'Anexos do card',
  'Nada a preencher: é um selo. O número mostra quantos anexos (fotos, PDF, planta/DWG) a oportunidade tem.',
  'Mostra, direto no card do funil, se a oportunidade já tem documentos anexados, sem precisar abrir a ficha — útil para saber se a proposta/planta já chegou.',
  'Card com "📎 3": a oportunidade tem 3 anexos. Toque no card para ver e baixar.',
  'Achar que o selo anexa arquivo: ele só conta. Para anexar, abra a oportunidade e use o cartão de anexos.',
  40, '/dashboard/projetos/oportunidades'),
 ('projetos.oportunidades.card_alerta', 'Oportunidades', 'Alerta do card',
  'Nada a preencher: é um aviso automático. Aparece quando a oportunidade parece duplicada ou com valor fora do padrão.',
  'Chama a atenção para revisar antes de seguir: uma oportunidade repetida do mesmo cliente, ou um valor muito acima da mediana das abertas (possível erro de digitação). É só um aviso — não bloqueia nada.',
  'Duas oportunidades "Forro — Tryo" do mesmo cliente → aviso "possível duplicata". Valor R$ 3.500.000 com mediana R$ 40.000 → aviso "valor fora do padrão".',
  'Tratar como erro: pode ser legítimo (obra grande de verdade). O aviso só pede conferência; você decide manter.',
  41, '/dashboard/projetos/oportunidades'),
 ('projetos.oportunidade.form.alerta', 'Oportunidades', 'Aviso de duplicata / valor fora do padrão',
  'Nada a preencher: o aviso aparece sozinho enquanto você preenche, quando a oportunidade parece repetida ou com valor muito fora do padrão.',
  'Evita cadastrar a mesma oportunidade duas vezes e pega valor digitado errado antes de salvar. É só um aviso — você pode salvar mesmo assim.',
  'Já existe "Forro — Tryo" aberta para o mesmo cliente → "possível duplicata". Valor 100× a mediana das abertas → "valor fora do padrão, confira".',
  'Deixar de conferir: se for duplicata real, cancele; se o valor estiver errado, corrija antes de salvar.',
  70, '/dashboard/projetos/oportunidades')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

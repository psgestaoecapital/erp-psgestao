-- HB0 · HBF-0.5 (correções) — apontar horas de mão de obra DIRETO na OS de obra.
-- Achado (auditor PDCA 24/10 06:02, /dashboard/projetos/obras/os, funcional 20): "Apontamento de produção/mão de obra
-- na OS" faltando. A OS dizia o que a equipe vai fazer, mas as horas da equipe só entravam pela tela da obra
-- (/obras/[id]/horas), sem saber de qual OS eram — não dava para ver quanto cada OS já custou.
--
-- Só objetos NOVOS (aditiva, RD-94.1 c):
-- 1) coluna os_id (nullable) em projetos_obra_mao_obra_apontamento + índice. Os lançamentos que já existem ficam como
--    estão (os_id NULL = lançado pela tela da obra). O custo continua na MESMA tabela — fonte única do custo de MO por
--    obra (Resultado por obra/Cockpit não mudam: a soma por obra é a mesma).
-- 2) fn_obra_os_apontar_horas(os, dados) — NOVA, com guarda de empresa (fn__guarda_empresa): grava o apontamento na
--    obra da OS, ligado à OS. Só OS aberta ou em execução; horas > 0; custo da hora >= 0; função da mesma empresa.
-- 3) "?" (RD-95) da ação e dos campos do formulário.
-- RD-55: nenhum dado de cliente é alterado. Plano de volta: DROP FUNCTION fn_obra_os_apontar_horas(uuid, jsonb);
-- ALTER TABLE projetos_obra_mao_obra_apontamento DROP COLUMN os_id; DELETE das chaves projetos.os_obra.apontar*.
ALTER TABLE public.projetos_obra_mao_obra_apontamento
  ADD COLUMN IF NOT EXISTS os_id uuid REFERENCES public.projetos_obra_os(id);
CREATE INDEX IF NOT EXISTS projetos_obra_mo_apont_os_idx
  ON public.projetos_obra_mao_obra_apontamento (os_id) WHERE os_id IS NOT NULL AND excluido_em IS NULL;

CREATE OR REPLACE FUNCTION public.fn_obra_os_apontar_horas(p_os_id uuid, p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_company uuid; v_obra uuid; v_status text; v_numero text; v_desc_os text; v_id uuid;
  v_funcao uuid := NULLIF(p_dados->>'funcao_id', '')::uuid;
  v_horas numeric := NULLIF(p_dados->>'horas', '')::numeric;
  v_custo numeric := NULLIF(p_dados->>'custo_hora', '')::numeric;
  v_desc text := NULLIF(btrim(COALESCE(p_dados->>'descricao', '')), '');
BEGIN
  SELECT company_id, obra_id, status, numero, descricao INTO v_company, v_obra, v_status, v_numero, v_desc_os
    FROM public.projetos_obra_os WHERE id = p_os_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF v_status NOT IN ('aberta', 'em_execucao') THEN
    RAISE EXCEPTION 'Só dá para apontar horas em OS aberta ou em execução';
  END IF;
  IF v_horas IS NULL OR v_horas <= 0 THEN RAISE EXCEPTION 'Informe as horas trabalhadas (maior que zero)'; END IF;
  IF v_custo IS NULL OR v_custo < 0 THEN RAISE EXCEPTION 'Informe o custo da hora'; END IF;
  IF v_funcao IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.erp_funcao_mao_obra
       WHERE id = v_funcao AND company_id = v_company) THEN
    RAISE EXCEPTION 'A função escolhida não é desta empresa';
  END IF;
  INSERT INTO public.projetos_obra_mao_obra_apontamento
    (company_id, obra_id, os_id, data, funcao_id, descricao, horas, custo_hora, criado_por)
  VALUES (v_company, v_obra, p_os_id, COALESCE(NULLIF(p_dados->>'data', '')::date, current_date), v_funcao,
    COALESCE(v_desc, v_numero || ' · ' || left(v_desc_os, 120)), v_horas, v_custo, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_os_apontar_horas(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_os_apontar_horas(uuid, jsonb) TO authenticated, service_role;

-- RD-95: "?" da ação e de cada campo do formulário de horas da OS.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('projetos.os_obra.apontar', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 14, 'Apontar horas',
   'Nada a preencher: abre o formulário de horas desta OS. Aparece só em OS aberta ou em execução.',
   'Lança as horas da equipe nesta OS. O valor vira custo de mão de obra da obra e aparece no Resultado por obra.',
   'Apontar 16 h de gesseiro na OSO-0004', 'Lançar as horas pela tela da obra e depois de novo aqui — o custo conta duas vezes.'),
  ('projetos.os_obra.horas_apontadas', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 15, 'Horas apontadas',
   'Nada a preencher: é a soma das horas e do custo já lançados nesta OS.',
   'Mostra quanto a OS já consumiu de mão de obra (horas × custo da hora).', '24 h · R$ 1.080,00',
   'Achar que inclui as horas lançadas pela tela da obra sem OS — essas contam só na obra.'),
  ('projetos.os_obra.apontar_data', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 16, 'Dia trabalhado',
   'O dia em que a equipe trabalhou. Vem com a data de hoje.', 'Coloca o custo no dia certo do Resultado por obra.',
   '23/10/2026', 'Deixar a data de hoje para um serviço feito ontem.'),
  ('projetos.os_obra.apontar_funcao', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 17, 'Função',
   'Opcional. A função de quem trabalhou (cadastro de Mão de obra). Ao escolher, o custo da hora vem preenchido.',
   'Separa o custo por função (gesseiro, ajudante) e traz o custo da hora cadastrado.', 'Gesseiro',
   'Escolher a função e trocar o custo da hora sem conferir a ficha.'),
  ('projetos.os_obra.apontar_horas', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 18, 'Horas',
   'Total de horas trabalhadas no dia, somando as pessoas da mesma função. Use vírgula para fração.',
   'Horas × custo da hora = custo de mão de obra lançado na obra.', '2 gesseiros × 8 h = 16', 'Lançar 8 quando foram duas pessoas.'),
  ('projetos.os_obra.apontar_custo_hora', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 19, 'Custo da hora (R$)',
   'Quanto custa uma hora dessa função, com encargos. Vem da ficha da função quando ela tem custo.',
   'Multiplica as horas para dar o custo lançado.', '45,00', 'Usar o salário por hora sem os encargos.'),
  ('projetos.os_obra.apontar_lancar', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 20, 'Lançar horas',
   'Nada a preencher: grava as horas nesta OS. Só grava ao clicar.',
   'O custo entra na obra na hora; para corrigir, exclua o lançamento na tela de horas da obra.',
   '16 h · R$ 720,00 lançados na OSO-0004', 'Clicar duas vezes — são dois lançamentos.')
ON CONFLICT (chave) DO NOTHING;

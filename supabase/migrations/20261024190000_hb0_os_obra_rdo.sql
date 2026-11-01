-- HB0 · HBF-0.5 (correções) — Diário de obra (RDO) direto na OS de obra: clima, se deu para trabalhar, efetivo,
-- o que foi feito, ocorrências e fotos do dia.
-- Achado (auditor PDCA 24/10, /dashboard/projetos/obras/os): faltava o registro do dia da equipe no canteiro. Não
-- existia tabela de RDO no banco (conferido 24/10: nenhuma tabela/função *rdo*).
--
-- Só objetos NOVOS (aditiva, RD-94.1 c):
-- 1) tabela projetos_obra_rdo — um RDO por OS e por dia (índice único parcial), RLS por empresa só de leitura,
--    REVOKE anon, exclusão lógica (RD-30). Grava só pela função com guarda.
-- 2) fn_obra_rdo_salvar(os, dados) — NOVA, com guarda de empresa (fn__guarda_empresa): cria ou atualiza o RDO do dia
--    da OS (OS aberta ou em execução). As fotos ficam no bucket projetos-plantas, que já isola por empresa (1ª pasta =
--    company_id; policy projetos_plantas_rw, sem mudança): a função só aceita caminho da pasta da empresa da OS.
-- 3) "?" (RD-95) da ação, do indicador e dos campos do formulário.
-- RD-55: nenhum dado de cliente é alterado. Plano de volta: DROP FUNCTION fn_obra_rdo_salvar(uuid, jsonb);
-- DROP TABLE projetos_obra_rdo; DELETE das chaves projetos.os_obra.rdo*.
CREATE TABLE IF NOT EXISTS public.projetos_obra_rdo (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  obra_id        uuid NOT NULL REFERENCES public.projetos_obras(id),
  os_id          uuid NOT NULL REFERENCES public.projetos_obra_os(id),
  data           date NOT NULL,
  clima          text NOT NULL DEFAULT 'sol' CHECK (clima IN ('sol', 'nublado', 'chuva', 'chuva_forte')),
  praticavel     boolean NOT NULL DEFAULT true,
  efetivo        integer NOT NULL DEFAULT 0 CHECK (efetivo >= 0),
  atividades     text,
  ocorrencias    text,
  fotos          text[] NOT NULL DEFAULT '{}' CHECK (cardinality(fotos) <= 10),
  criado_por     uuid,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz,
  excluido_por   uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS projetos_obra_rdo_os_dia_uq
  ON public.projetos_obra_rdo (os_id, data) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS projetos_obra_rdo_idx
  ON public.projetos_obra_rdo (company_id, obra_id, data DESC) WHERE excluido_em IS NULL;

ALTER TABLE public.projetos_obra_rdo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.projetos_obra_rdo FROM PUBLIC, anon;
DROP POLICY IF EXISTS projetos_obra_rdo_ler ON public.projetos_obra_rdo;
CREATE POLICY projetos_obra_rdo_ler ON public.projetos_obra_rdo FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT ON public.projetos_obra_rdo TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_obra_rdo_salvar(p_os_id uuid, p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_company uuid; v_obra uuid; v_status text; v_id uuid;
  v_data date := COALESCE(NULLIF(p_dados->>'data', '')::date, current_date);
  v_clima text := COALESCE(NULLIF(p_dados->>'clima', ''), 'sol');
  v_efetivo integer := COALESCE(NULLIF(p_dados->>'efetivo', '')::integer, 0);
  v_ativ text := NULLIF(btrim(COALESCE(p_dados->>'atividades', '')), '');
  v_ocor text := NULLIF(btrim(COALESCE(p_dados->>'ocorrencias', '')), '');
  v_fotos text[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_dados->'fotos', '[]'::jsonb))), '{}');
BEGIN
  SELECT company_id, obra_id, status INTO v_company, v_obra, v_status
    FROM public.projetos_obra_os WHERE id = p_os_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF v_status NOT IN ('aberta', 'em_execucao') THEN
    RAISE EXCEPTION 'Só dá para lançar o diário em OS aberta ou em execução';
  END IF;
  IF v_data > current_date THEN RAISE EXCEPTION 'O diário é do dia que já aconteceu — a data não pode ser futura'; END IF;
  IF v_clima NOT IN ('sol', 'nublado', 'chuva', 'chuva_forte') THEN RAISE EXCEPTION 'Clima inválido'; END IF;
  IF v_efetivo < 0 THEN RAISE EXCEPTION 'O efetivo não pode ser negativo'; END IF;
  IF v_ativ IS NULL AND v_ocor IS NULL THEN RAISE EXCEPTION 'Conte o que foi feito ou o que aconteceu no dia'; END IF;
  IF cardinality(v_fotos) > 10 THEN RAISE EXCEPTION 'No máximo 10 fotos por dia'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_fotos) f WHERE f NOT LIKE v_company::text || '/rdo/' || p_os_id::text || '/%') THEN
    RAISE EXCEPTION 'Foto fora da pasta desta OS';
  END IF;

  SELECT id INTO v_id FROM public.projetos_obra_rdo WHERE os_id = p_os_id AND data = v_data AND excluido_em IS NULL;
  IF v_id IS NULL THEN
    INSERT INTO public.projetos_obra_rdo
      (company_id, obra_id, os_id, data, clima, praticavel, efetivo, atividades, ocorrencias, fotos, criado_por)
    VALUES (v_company, v_obra, p_os_id, v_data, v_clima, COALESCE((p_dados->>'praticavel')::boolean, true), v_efetivo,
      v_ativ, v_ocor, v_fotos, auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.projetos_obra_rdo SET clima = v_clima, praticavel = COALESCE((p_dados->>'praticavel')::boolean, true),
      efetivo = v_efetivo, atividades = v_ativ, ocorrencias = v_ocor, fotos = v_fotos, atualizado_em = now()
    WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_rdo_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_rdo_salvar(uuid, jsonb) TO authenticated, service_role;

-- RD-95: "?" da ação, do indicador e de cada campo do diário da OS.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('projetos.os_obra.rdo', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 21, 'Diário do dia (RDO)',
   'Nada a preencher: abre o diário de obra desta OS. Aparece só em OS aberta ou em execução.',
   'Registra como foi o dia no canteiro: clima, quem trabalhou, o que foi feito, problemas e fotos. É a prova do andamento.',
   'Diário de 23/10 da OSO-0004', 'Deixar para preencher no fim da semana — os detalhes do dia se perdem.'),
  ('projetos.os_obra.rdo_registrados', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 22, 'Diários',
   'Nada a preencher: quantos dias já têm diário nesta OS e a data do último.',
   'Mostra se a equipe está registrando o dia a dia da OS.', '4 dias · último 23/10', 'Achar que conta os dias sem diário.'),
  ('projetos.os_obra.rdo_data', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 23, 'Dia',
   'O dia do diário. Vem com hoje; não aceita data futura. Escolher um dia que já tem diário abre esse diário para corrigir.',
   'Um diário por OS e por dia.', '23/10/2026', 'Lançar o diário de ontem com a data de hoje.'),
  ('projetos.os_obra.rdo_clima', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 24, 'Clima',
   'Como estava o tempo no canteiro durante o expediente.',
   'Justifica atraso por chuva e mostra os dias perdidos.', 'Chuva', 'Marcar o clima da previsão, não o que aconteceu.'),
  ('projetos.os_obra.rdo_praticavel', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 25, 'Deu para trabalhar',
   'Desmarque se a equipe não conseguiu trabalhar no dia (chuva, falta de material, liberação da área).',
   'Separa dia trabalhado de dia parado na conversa de prazo com o cliente.', 'Desmarcado: chuva forte a manhã toda',
   'Deixar marcado num dia parado — o atraso fica sem justificativa.'),
  ('projetos.os_obra.rdo_efetivo', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 26, 'Efetivo (pessoas)',
   'Quantas pessoas da equipe trabalharam nesta OS no dia.', 'Mostra o tamanho da equipe em campo dia a dia.', '3',
   'Contar quem passou rapidamente e não trabalhou.'),
  ('projetos.os_obra.rdo_atividades', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 27, 'O que foi feito',
   'O serviço executado no dia, com quantidade quando der.', 'É o avanço do dia, em palavras, para a obra e o cliente.',
   'Forro fechado nas salas 201 e 202 (34 m²)', 'Escrever só "trabalhando" — não diz o que avançou.'),
  ('projetos.os_obra.rdo_ocorrencias', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 28, 'Ocorrências',
   'Problemas, visitas, faltas e entregas do dia. Opcional quando não houve nada.',
   'Guarda o fato com data: protege a empresa numa discussão de prazo ou de qualidade.',
   'Faltou perfil de 3 m; entrega remarcada para 24/10', 'Avisar só no WhatsApp — o registro some.'),
  ('projetos.os_obra.rdo_fotos', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 29, 'Fotos do dia',
   'Tire ou escolha até 10 fotos do serviço. No celular abre a câmera.',
   'Mostra como o serviço ficou no dia — prova de execução e de qualidade.', 'Foto do forro fechado na sala 201',
   'Fotografar só o fim da obra — sem fotos do caminho não há como provar o andamento.'),
  ('projetos.os_obra.rdo_salvar', '/dashboard/projetos/obras/os', 'OS de obra', 'hub_projetos', 30, 'Salvar diário',
   'Nada a preencher: grava o diário do dia (e envia as fotos). Só grava ao clicar.',
   'Se o dia já tinha diário, ele é atualizado — não duplica.', 'Diário de 23/10 salvo com 2 fotos',
   'Fechar a tela antes de terminar o envio das fotos.')
ON CONFLICT (chave) DO NOTHING;

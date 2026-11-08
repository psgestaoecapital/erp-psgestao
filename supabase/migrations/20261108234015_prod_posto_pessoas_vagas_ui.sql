-- Indústria/RH · Postos: listar as PESSOAS alocadas (nominal + CPF) de um posto, para a tela
-- /dashboard/produtividade mostrar "quem está no posto" e a VAGA ABERTA (quadro × ocupado real).
-- Desenho do CEO 08/11 (tarefa beebd8a4): pessoa + CPF por posto; vaga = posto sem pessoa.
--
-- RD-26: a GRAVAÇÃO já existe e está publicada (fn_prod_posto_pessoa_alocar / _desalocar, com guarda de
-- escopo SECURITY DEFINER, CPF manual OU funcionário, vigência idempotente e audit_log_global). Esta migration
-- só acrescenta a LEITURA que faltava para o front enxergar a alocação nominal — nenhuma dessas é alterada.
--
-- ADITIVA: 1 função de LEITURA nova + 3 textos de ajuda (RD-95). Não cria/altera tabela, RLS, policy ou grant
-- de dado; não toca dado de cliente. A função é SECURITY DEFINER com a MESMA guarda das de gravação
-- (company do usuário via get_user_company_ids() OU is_admin()); fail-closed; REVOKE anon.
--
-- RD-38 (produção, só leitura, nesta sessão): prod_posto_pessoa tem a coluna cpf (text) e funcionario_id (uuid,
-- opcional); compliance_funcionarios tem nome_completo. prod_posto tem company_id. As 3 chaves de ajuda ainda não
-- existem em erp_ajuda_campo (ON CONFLICT DO NOTHING garante idempotência).
--
-- RD-52: arquivo + PR, versão 20261108234015 acima da última da main (…223435), faixa de segundos :10–:19 (dev7).
-- Sensível (lê CPF, SECURITY DEFINER) → PR com revisao-eng-chefe; não força merge.

CREATE OR REPLACE FUNCTION public.fn_prod_posto_pessoas_listar(p_posto_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid;
  v_itens jsonb;
BEGIN
  IF p_posto_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'posto_obrigatorio');
  END IF;

  SELECT company_id INTO v_comp FROM prod_posto WHERE id = p_posto_id;
  IF v_comp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'posto_nao_encontrado');
  END IF;

  -- fail-closed: só a empresa do usuário (ou admin) enxerga a alocação nominal (CPF é dado pessoal, LGPD)
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'id',               pp.id,
             'funcionario_id',   pp.funcionario_id,
             'nome',             cf.nome_completo,
             'cpf',              pp.cpf,
             'origem',           CASE WHEN pp.funcionario_id IS NOT NULL THEN 'ponto' ELSE 'manual' END,
             'turno_id',         pp.turno_id,
             'vigencia_inicio',  pp.vigencia_inicio
           )
           ORDER BY lower(COALESCE(cf.nome_completo, pp.cpf, '')), pp.criado_em
         ), '[]'::jsonb)
    INTO v_itens
    FROM prod_posto_pessoa pp
    LEFT JOIN compliance_funcionarios cf
      ON cf.id = pp.funcionario_id AND cf.company_id = v_comp
   WHERE pp.posto_id = p_posto_id
     AND pp.vigencia_fim IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'ocupado', jsonb_array_length(v_itens),
    'pessoas', v_itens
  );
END
$function$;

REVOKE ALL ON FUNCTION public.fn_prod_posto_pessoas_listar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_posto_pessoas_listar(uuid) TO authenticated, service_role;

-- RD-95: "?" dos campos novos da seção "Pessoas e vagas" do posto (/dashboard/produtividade).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('prod.posto.pessoas_vagas', '/dashboard/produtividade', 'Cadastro por fluxo', 'Pessoas e vagas do posto',
   'Indicador automático: não se preenche. Compara quantas pessoas o posto PRECISA (o quadro definido em "Pessoas", no turno) com quantas estão de fato alocadas por nome/CPF agora.',
   'Mostra, posto a posto, a VAGA ABERTA (quadro maior que o ocupado) — quem precisa repor e onde. Vaga = posto sem pessoa.',
   'Quadro de 4 pessoas com 3 alocadas → "Ocupado 3 de 4 · 1 vaga aberta".',
   'Confundir o quadro (quantas o posto precisa) com o ocupado (quantas estão alocadas): a vaga é a diferença.',
   'industria', 37, 'publicado'),
  ('prod.posto.pessoa_cpf', '/dashboard/produtividade', 'Cadastro por fluxo', 'CPF da pessoa no posto',
   'Digite o CPF (11 dígitos) da pessoa que ocupa o posto. Onde há integração de ponto, o CPF já vem do ponto; onde não há, o RH preenche aqui, manualmente.',
   'Liga a pessoa (por CPF) ao posto do fluxo, para medir ocupação, vaga aberta e o custo por pessoa do posto.',
   '529.982.247-25 (só os 11 dígitos, a máscara é automática).',
   'Informar menos de 11 dígitos ou repetir a mesma pessoa no mesmo posto (a alocação ativa anterior é encerrada).',
   'industria', 38, 'publicado'),
  ('prod.posto.pessoa_turno', '/dashboard/produtividade', 'Cadastro por fluxo', 'Turno da pessoa no posto',
   'Opcional. Escolha o turno em que a pessoa trabalha neste posto. A lista traz os turnos cadastrados do fluxo.',
   'Separa a ocupação por turno quando o posto roda em mais de um horário, para a vaga e o custo baterem por turno.',
   'Turno A (06:00–14:00).',
   'Deixar o turno em branco quando o posto tem turnos distintos: as pessoas ficam todas no mesmo balde.',
   'industria', 39, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
ON CONFLICT (chave) DO NOTHING;

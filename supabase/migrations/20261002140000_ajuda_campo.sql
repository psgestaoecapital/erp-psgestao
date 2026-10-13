-- Ajuda de campo (CEO 01/10, regra para TODO o Hub de Projetos): cada campo tem um "?" ao lado do rótulo que abre um
-- cartão curto com 4 blocos fixos — O que preencher · Para que serve no cálculo · Exemplo · Erro comum — e "ver mais"
-- para o artigo da Central de Ajuda. Textos no BANCO (editáveis sem deploy, reaproveitáveis por outras verticais);
-- cliques registrados no mesmo erp_ajuda_uso da Central. Lista do banco e os 82 textos da Mão de obra aprovados pelo
-- CEO em 01/10. Nada é apagado.

-- ───────────────────────────── textos ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_ajuda_campo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text NOT NULL UNIQUE CHECK (chave ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),   -- ex.: projetos.mao_obra.ficha.horas
  rota text NOT NULL,                       -- tela onde o campo aparece (/dashboard/projetos/mao-obra)
  grupo text,                               -- agrupamento na edição (Funções, Ficha…)
  rotulo text NOT NULL,
  o_que_preencher text NOT NULL,
  para_que_serve text NOT NULL,
  exemplo text NOT NULL,
  erro_comum text NOT NULL,
  artigo_id uuid REFERENCES public.erp_ajuda_artigo(id),
  vertical text,
  ordem int NOT NULL DEFAULT 0,
  versao int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'publicado' CHECK (status IN ('rascunho', 'publicado')),
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ajuda_campo_rota ON public.erp_ajuda_campo (rota, ordem);
ALTER TABLE public.erp_ajuda_campo ENABLE ROW LEVEL SECURITY;
-- leitura: logado vê só o publicado; escrita só pela função de salvar (admin PS)
DROP POLICY IF EXISTS ajuda_campo_sel ON public.erp_ajuda_campo;
CREATE POLICY ajuda_campo_sel ON public.erp_ajuda_campo FOR SELECT TO authenticated USING (status = 'publicado' OR public.is_admin());
REVOKE ALL ON public.erp_ajuda_campo FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.erp_ajuda_campo FROM authenticated;
GRANT SELECT ON public.erp_ajuda_campo TO authenticated;

-- ───────────────────────────── uso (o mesmo registro da Central de Ajuda) ─────────────────────────────
ALTER TABLE public.erp_ajuda_uso
  ADD COLUMN IF NOT EXISTS campo_chave text,
  ADD COLUMN IF NOT EXISTS acao text CHECK (acao IS NULL OR acao IN ('abriu', 'ver_mais'));
CREATE INDEX IF NOT EXISTS ix_ajuda_uso_campo ON public.erp_ajuda_uso (campo_chave, criado_em) WHERE campo_chave IS NOT NULL;

-- ───────────────────────────── a tela busca os textos de uma vez ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ajuda_campo_listar(p_rota text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'campos', COALESCE((SELECT jsonb_object_agg(c.chave, jsonb_build_object('rotulo', c.rotulo, 'o_que_preencher', c.o_que_preencher,
                 'para_que_serve', c.para_que_serve, 'exemplo', c.exemplo, 'erro_comum', c.erro_comum, 'artigo_id', c.artigo_id, 'versao', c.versao))
               FROM erp_ajuda_campo c WHERE c.rota = p_rota AND c.status = 'publicado'), '{}'::jsonb),
    'artigos', COALESCE((SELECT jsonb_object_agg(a.id, jsonb_build_object('titulo', a.titulo, 'resumo', a.resumo, 'corpo_md', a.corpo_md))
               FROM erp_ajuda_artigo a WHERE a.status = 'publicado' AND a.company_id IS NULL
                 AND a.id IN (SELECT c.artigo_id FROM erp_ajuda_campo c WHERE c.rota = p_rota AND c.status = 'publicado')), '{}'::jsonb))
  WHERE auth.uid() IS NOT NULL
$function$;
REVOKE ALL ON FUNCTION public.fn_ajuda_campo_listar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ajuda_campo_listar(text) TO authenticated, service_role;

-- ───────────────────────────── editar sem deploy (admin PS) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ajuda_campo_salvar(p_chave text, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a erp_ajuda_campo%ROWTYPE; v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Só o admin PS edita a ajuda de campo.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_dados->>'o_que_preencher', ''))) < 3 OR length(btrim(COALESCE(p_dados->>'para_que_serve', ''))) < 3
     OR length(btrim(COALESCE(p_dados->>'exemplo', ''))) < 1 OR length(btrim(COALESCE(p_dados->>'erro_comum', ''))) < 3 THEN
    RAISE EXCEPTION 'Preencha os 4 blocos: o que preencher, para que serve, exemplo e erro comum.';
  END IF;
  SELECT * INTO a FROM erp_ajuda_campo WHERE chave = p_chave FOR UPDATE;
  IF FOUND THEN
    UPDATE erp_ajuda_campo SET rotulo = COALESCE(NULLIF(btrim(p_dados->>'rotulo'), ''), rotulo),
           o_que_preencher = btrim(p_dados->>'o_que_preencher'), para_que_serve = btrim(p_dados->>'para_que_serve'),
           exemplo = btrim(p_dados->>'exemplo'), erro_comum = btrim(p_dados->>'erro_comum'),
           artigo_id = CASE WHEN p_dados ? 'artigo_id' THEN NULLIF(p_dados->>'artigo_id', '')::uuid ELSE artigo_id END,
           status = COALESCE(NULLIF(p_dados->>'status', ''), status),
           versao = versao + 1, atualizado_por = auth.uid(), atualizado_em = now()
     WHERE id = a.id RETURNING id INTO v_id;
  ELSE
    IF NULLIF(btrim(p_dados->>'rota'), '') IS NULL OR NULLIF(btrim(p_dados->>'rotulo'), '') IS NULL THEN
      RAISE EXCEPTION 'Campo novo: informe a tela (rota) e o rótulo.';
    END IF;
    INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, artigo_id, vertical, ordem, status, atualizado_por)
    VALUES (p_chave, btrim(p_dados->>'rota'), NULLIF(btrim(p_dados->>'grupo'), ''), btrim(p_dados->>'rotulo'), btrim(p_dados->>'o_que_preencher'),
            btrim(p_dados->>'para_que_serve'), btrim(p_dados->>'exemplo'), btrim(p_dados->>'erro_comum'), NULLIF(p_dados->>'artigo_id', '')::uuid,
            NULLIF(btrim(p_dados->>'vertical'), ''), COALESCE(NULLIF(p_dados->>'ordem', '')::int, 0), COALESCE(NULLIF(p_dados->>'status', ''), 'rascunho'), auth.uid())
    RETURNING id INTO v_id;
  END IF;
  -- o texto anterior fica no audit (versão a versão)
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (NULL, auth.uid(), 'erp_ajuda_campo', v_id::text, CASE WHEN a.id IS NULL THEN 'AJUDA_CAMPO_CRIADA' ELSE 'AJUDA_CAMPO_EDITADA' END,
          CASE WHEN a.id IS NULL THEN NULL ELSE to_jsonb(a) END, (SELECT to_jsonb(x) FROM erp_ajuda_campo x WHERE x.id = v_id));
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_ajuda_campo_salvar(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ajuda_campo_salvar(text, jsonb) TO authenticated, service_role;

-- ───────────────────────────── clique no "?" ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ajuda_campo_uso(p_chave text, p_company_id uuid, p_rota text, p_acao text DEFAULT 'abriu')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Sem sessão'); END IF;
  -- mesma regra de fn_ajuda_registrar_uso: empresa só se o usuário tiver acesso a ela
  IF p_company_id IS NOT NULL AND NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso');
  END IF;
  IF p_acao NOT IN ('abriu', 'ver_mais') OR NOT EXISTS (SELECT 1 FROM erp_ajuda_campo WHERE chave = p_chave) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Campo de ajuda desconhecido');
  END IF;
  INSERT INTO erp_ajuda_uso (company_id, user_id, pergunta, artigo_id, rota, campo_chave, acao)
  VALUES (p_company_id, auth.uid(), 'campo:' || p_chave, (SELECT artigo_id FROM erp_ajuda_campo WHERE chave = p_chave), left(p_rota, 300), p_chave, p_acao)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_ajuda_campo_uso(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ajuda_campo_uso(text, uuid, text, text) TO authenticated, service_role;

-- ───────────────────────────── os 82 textos da Mão de obra (aprovados pelo CEO em 01/10) ─────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, artigo_id, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/mao-obra', 'hub_construcao',
       (SELECT a.id FROM public.erp_ajuda_artigo a WHERE a.rota_ref = '/dashboard/projetos/mao-obra' AND a.status = 'publicado' AND a.company_id IS NULL
         ORDER BY a.atualizado_em DESC NULLS LAST LIMIT 1), 'publicado'
FROM (VALUES
  ('projetos.mao_obra.funcao.nome', 'Funções', 'Nome da função', 'O nome do trabalho, como a obra chama: Gesseiro, Pintor, Servente.', 'Junta as fichas da equipe. O custo da hora da função é a média das fichas conferidas com esse nome.', 'Gesseiro', 'Criar "Gesseiro" e "Gesseiro montador" para o mesmo trabalho. A média se divide em duas. Use "Unir".', 0),
  ('projetos.mao_obra.funcao.cbo', 'Funções', 'CBO', 'O código da profissão na carteira de trabalho (Classificação Brasileira de Ocupações). Opcional.', 'Com CBO, a mesma função casa entre as empresas do grupo mesmo com nomes diferentes.', '7155-05 (gesseiro)', 'Inventar um número. Se não souber, deixe em branco: o sistema casa pelo nome.', 1),
  ('projetos.mao_obra.funcao.forma', 'Funções', 'Forma de pagamento', 'Como essa função costuma ser paga: por mês, por hora, por produção (m², metro, ponto, peça) ou por diária.', 'Não muda o custo. Serve de sugestão: ao escolher a função na ficha, o componente certo já aparece.', 'Gesseiro: por produção, em m²', 'Achar que isso define o pagamento de todos. Cada ficha pode ter outros componentes.', 2),
  ('projetos.mao_obra.funcao.unidade', 'Funções', 'Unidade de produção', 'A unidade em que a produção é medida: m², metro, ponto, peça.', 'É a unidade do "custo por unidade produzida" e a do serviço do catálogo.', 'Forro: m² · Elétrica: ponto', 'Usar m² para um serviço medido em metro linear (rodapé, sanca).', 3),
  ('projetos.mao_obra.funcao.custo_manual', 'Funções', 'Custo/hora manual', 'Um custo da hora provisório, só enquanto ninguém da função estiver conferido.', 'Entra no catálogo no lugar da média. Deixa de valer sozinho quando a primeira ficha da função for conferida.', 'R$ 38,00', 'Deixar o manual "para sempre". O certo é cadastrar e conferir a equipe.', 4),
  ('projetos.mao_obra.funcao.ativa', 'Funções', 'Função ativa', 'Desmarque quando a empresa não usa mais essa função.', 'Função inativa sai da lista da ficha e da média. Nada é apagado.', '"Ajudante de pintor" que virou "Servente"', 'Inativar uma função que ainda tem fichas valendo.', 5),
  ('projetos.mao_obra.funcao.unir', 'Funções', 'Unir a outra função', 'Escolha a função que é o mesmo trabalho com outro nome.', 'As duas passam a contar juntas na média do custo da hora.', 'Unir "Gesseiro montador" a "Gesseiro"', 'Unir trabalhos diferentes (Pedreiro com Servente). A média fica errada.', 6),
  ('projetos.mao_obra.funcao.modelo', 'Funções', 'Usar funções-modelo', 'Cria 10 funções comuns de obra (só o nome e a forma de pagamento). Só aparece quando a empresa não tem nenhuma.', 'Não cria custo. O custo vem das fichas que você cadastrar e conferir.', 'Servente, Pedreiro, Gesseiro, Pintor…', 'Esperar custo pronto. Depois de criar, cadastre a equipe.', 7),
  ('projetos.mao_obra.pessoa.nome', 'Pessoa', 'Nome completo', 'O nome como está no documento.', 'Não entra na conta. Identifica a pessoa no cadastro único, o mesmo do SST.', 'João Carlos da Silva', 'Apelido ou nome pela metade. Fica difícil achar a pessoa depois.', 8),
  ('projetos.mao_obra.pessoa.cpf', 'Pessoa', 'CPF', 'Os 11 números do CPF. O sistema confere os dígitos.', 'Não entra na conta. Evita cadastrar a mesma pessoa duas vezes na empresa.', '529.982.247-25', 'Digitar o CPF de outra pessoa ou com número trocado. O sistema recusa.', 9),
  ('projetos.mao_obra.pessoa.admissao', 'Pessoa', 'Data de admissão', 'O dia em que a pessoa começou a trabalhar na empresa.', 'Não entra na conta do mês. Marca desde quando a pessoa existe na equipe.', '01/09/2026', 'Usar a data de hoje para quem já trabalha há anos.', 10),
  ('projetos.mao_obra.pessoa.documentos', 'Pessoa', 'RG e data de nascimento', 'Opcional. Preencha se tiver em mãos.', 'Não entra na conta. Completa o cadastro (o SST usa).', 'RG 12.345.678-9', 'Travar o cadastro por falta disso. Pode completar depois.', 11),
  ('projetos.mao_obra.pessoa.contato', 'Pessoa', 'Telefone e e-mail', 'Opcional. Contato da pessoa.', 'Não entra na conta.', '(45) 99999-0000', 'Colocar o contato do encarregado no lugar do da pessoa.', 12),
  ('projetos.mao_obra.pessoa.endereco', 'Pessoa', 'Endereço (CEP, rua, número, bairro, cidade, UF)', 'Opcional. Onde a pessoa mora.', 'Não entra na conta. Fica no cadastro único.', 'CEP 85810-000', 'Colocar o endereço da obra. Para a obra existe o campo "Obra atual".', 13),
  ('projetos.mao_obra.pessoa.matricula', 'Pessoa', 'Matrícula', 'Opcional. O número da pessoa na folha de pagamento.', 'Não entra na conta. Ajuda a conferir a ficha com a folha.', '0153', 'Repetir a matrícula de outra pessoa.', 14),
  ('projetos.mao_obra.pessoa.cargo_setor', 'Pessoa', 'Cargo e setor', 'Opcional. Como a pessoa aparece na folha e em que equipe ou setor trabalha.', 'Não entra na conta. A função (abaixo) é que define o custo.', 'Cargo: Montador · Setor: Equipe 2', 'Achar que o cargo substitui a função. A média usa a função.', 15),
  ('projetos.mao_obra.pessoa.obra', 'Pessoa', 'Obra atual', 'Opcional. A obra em que a pessoa está agora.', 'Não entra na conta. É só para localizar a pessoa.', 'Residencial Jardins', 'Usar para dividir custo entre obras. Isso é feito no apontamento da obra.', 16),
  ('projetos.mao_obra.ficha.funcao', 'Ficha', 'Função', 'O trabalho que a pessoa faz. Escolha da lista de funções.', 'A ficha entra na média do custo da hora dessa função. A função também sugere o fixo médio e a forma de pagamento.', 'Gesseiro', 'Escolher pelo cargo da carteira e não pelo que a pessoa faz na obra.', 17),
  ('projetos.mao_obra.ficha.vinculo', 'Ficha', 'Vínculo', 'Como a pessoa é contratada: CLT, CLT intermitente, autônomo (RPA), MEI/PJ/empreiteiro ou diarista.', 'Define os encargos. CLT leva DSR, 13º, férias, INSS, FGTS e rescisão. RPA e diarista levam INSS de autônomo. MEI/PJ não leva, salvo MEI em serviço de obra.', 'Gesseiro registrado: CLT · Eletricista com CNPJ: MEI/PJ', 'Marcar diarista para quem trabalha todo dia. O custo fica baixo e há risco trabalhista.', 18),
  ('projetos.mao_obra.ficha.horas', 'Ficha', 'Horas produtivas por mês', 'As horas que a pessoa realmente produz na obra no mês, sem deslocamento, chuva e espera. Padrão 176.', 'Divide o custo mensal para chegar ao custo da hora. Se usar 220 (horas pagas), a hora sai mais barata do que é e o orçamento fica abaixo do custo.', '176', 'Usar 220. A hora sai barata e o orçamento fica abaixo do custo.', 19),
  ('projetos.mao_obra.ficha.perfil_descricao', 'Ficha', 'Descrição do perfil', 'Um nome para o grupo de pessoas iguais, sem nome de ninguém.', 'Não entra na conta. Identifica o perfil na lista.', 'Gesseiro padrão', 'Colocar o nome de uma pessoa. Para pessoa, use "Novo funcionário".', 20),
  ('projetos.mao_obra.ficha.perfil_quantidade', 'Ficha', 'Quantidade de pessoas', 'Quantas pessoas ganham parecido e fazem o mesmo trabalho.', 'O perfil pesa na média da função como esse número de pessoas.', '4', 'Deixar 1 para uma equipe de 4. A média da função fica torta.', 21),
  ('projetos.mao_obra.ficha.perfil_setor', 'Ficha', 'Setor', 'Opcional. A equipe ou setor do perfil.', 'Não entra na conta.', 'Equipe de forro', 'Usar o setor para separar custo. Quem separa é a função.', 22),
  ('projetos.mao_obra.ficha.mei_obra', 'Ficha', 'MEI em serviço de obra', 'Ligue quando o MEI faz hidráulica, elétrica, pintura, alvenaria ou carpintaria. Já vem ligado nessas funções. A confirmar com o contador.', 'Soma 20% de INSS patronal sobre o valor pago, que a empresa contratante recolhe (LC 123).', 'Pintor MEI: R$ 2.400 → custo R$ 2.880', 'Desligar para um pintor MEI. O custo fica 20% abaixo do real.', 23),
  ('projetos.mao_obra.comp.tipo', 'Componentes', 'Tipo do componente', 'Cada parte do que a pessoa ganha vira um componente: fixo, produção, empreitada, diária, comissão, bônus, hora extra ou adicional. Precisa de pelo menos um com valor.', 'O sistema soma o valor do mês de cada componente e aplica os encargos certos de cada um.', 'Gesseiro: fixo R$ 2.000 + produção R$ 3,00/m²', 'Somar tudo num valor só. Os encargos de cada parte são diferentes e o custo erra.', 24),
  ('projetos.mao_obra.comp.fixo_mensal', 'Componentes', 'Fixo mensal (R$ por mês)', 'O salário fixo do mês, como está na carteira ou no contrato.', 'Entra inteiro no custo. Já inclui o descanso semanal (DSR), por isso não gera DSR de novo.', 'R$ 2.000,00', 'Colocar o líquido do contracheque. Use o valor bruto.', 25),
  ('projetos.mao_obra.comp.fixo_hora', 'Componentes', 'Fixo por hora (R$ por hora e horas no mês)', 'O valor da hora e quantas horas a pessoa recebe no mês.', 'Valor do mês = valor da hora × horas. Também é a base da hora extra e do adicional noturno.', 'R$ 12,00 × 176 h = R$ 2.112', 'Colocar só as horas produtivas aqui. Aqui vão as horas pagas.', 26),
  ('projetos.mao_obra.comp.producao_valor', 'Componentes', 'Produção: R$ por unidade', 'Quanto a pessoa ganha por unidade produzida (m², metro, ponto, peça).', 'Valor do mês = R$ por unidade × volume médio. Gera DSR de 1/6 quando for CLT.', 'R$ 3,00 por m²', 'Colocar o preço que a empresa cobra do cliente. Aqui é o que a pessoa recebe.', 27),
  ('projetos.mao_obra.comp.producao_unidade', 'Componentes', 'Unidade', 'A unidade da produção: m², metro, ponto, peça.', 'É a unidade do "custo por unidade produzida".', 'm²', 'Misturar unidades: pagar por metro e marcar m².', 28),
  ('projetos.mao_obra.comp.producao_volume', 'Componentes', 'Volume médio no mês', 'Quanto a pessoa produz num mês normal, em média.', 'Multiplica o R$ por unidade. Também divide o custo mensal para chegar ao custo por unidade.', '500 m² por mês', 'Usar o melhor mês do ano. A média deve incluir meses fracos.', 29),
  ('projetos.mao_obra.comp.producao_estimado', 'Componentes', 'Volume estimado', 'Deixe marcado enquanto o volume for um palpite. Desmarque quando vier da medição das obras.', 'Não muda a conta. Marca o resultado como estimativa na tela.', 'Marcado no cadastro inicial', 'Desmarcar sem ter medição. O custo parece mais certo do que é.', 30),
  ('projetos.mao_obra.comp.empreitada', 'Componentes', 'Empreitada: valor da obra e dias da obra', 'O valor fechado da empreitada e quantos dias a obra dura.', 'Vira valor do mês: valor × 30 ÷ dias da obra.', 'R$ 9.000 em 45 dias = R$ 6.000 por mês', 'Colocar dias úteis trabalhados. Use os dias corridos da obra.', 31),
  ('projetos.mao_obra.comp.diaria', 'Componentes', 'Diária: R$ por dia e dias no mês', 'O valor do dia e quantos dias a pessoa trabalha no mês, em média.', 'Valor do mês = diária × dias. Acima de 8 dias no mês o sistema avisa risco trabalhista.', 'R$ 150 × 8 dias = R$ 1.200', 'Diarista todo dia da semana. Isso pode virar vínculo de emprego. Fale com o contador.', 32),
  ('projetos.mao_obra.comp.comissao', 'Componentes', 'Comissão: % e base média', 'O percentual da comissão e a base média do mês sobre a qual ela é calculada.', 'Valor do mês = % × base. Gera DSR de 1/6 quando for CLT.', '5% sobre R$ 20.000 = R$ 1.000', 'Usar a base de um mês excepcional. Use a média.', 33),
  ('projetos.mao_obra.comp.bonus', 'Componentes', 'Bônus / prêmio', 'O valor médio por mês de prêmio ou bônus.', 'Soma no custo. Por padrão não leva encargos nem integra a remuneração. A confirmar com o contador.', 'R$ 200 por mês', 'Chamar de bônus um valor pago todo mês sem condição. Esse valor costuma integrar o salário.', 34),
  ('projetos.mao_obra.comp.hora_extra', 'Componentes', 'Horas extras habituais', 'Quantas horas extras a pessoa faz num mês normal, o adicional (50% padrão) e, se quiser, o valor da hora.', 'Valor do mês = horas × valor da hora × (1 + adicional). Sem valor da hora, usa fixo ÷ 220. Gera DSR de 1/6.', '10 h × R$ 10,00 × 1,5 = R$ 150', 'Lançar hora extra rara como habitual. Só entra o que se repete todo mês.', 35),
  ('projetos.mao_obra.comp.insalubridade', 'Componentes', 'Insalubridade (% do salário mínimo)', 'O grau: 10%, 20% ou 40%, conforme o laudo.', 'Valor do mês = % × salário mínimo de referência.', '20% × R$ 1.518 = R$ 303,60', 'Calcular sobre o salário da pessoa. A base é o salário mínimo.', 36),
  ('projetos.mao_obra.comp.periculosidade', 'Componentes', 'Periculosidade (% do fixo)', 'O percentual, normalmente 30%.', 'Valor do mês = % × fixo mensal da pessoa.', '30% × R$ 2.000 = R$ 600', 'Somar insalubridade e periculosidade juntas. A lei manda escolher uma.', 37),
  ('projetos.mao_obra.comp.noturno', 'Componentes', 'Adicional noturno', 'Horas noturnas no mês e o adicional (20% padrão).', 'Valor do mês = horas × valor da hora × adicional.', '20 h × R$ 10 × 20% = R$ 40', 'Lançar todas as horas do turno. Só as noturnas.', 38),
  ('projetos.mao_obra.comp.adicional_outro', 'Componentes', 'Outro adicional (R$ por mês)', 'Outro valor fixo que a pessoa recebe todo mês.', 'Soma no custo com os encargos marcados nas chaves.', 'Adicional de função R$ 150', 'Lançar aqui um benefício (vale, plano). Benefício tem campo próprio.', 39),
  ('projetos.mao_obra.comp.descricao', 'Componentes', 'Descrição do componente', 'Opcional. Um lembrete do que é esse valor.', 'Não entra na conta.', 'Prêmio de produção do forro', 'Deixar a descrição diferente do tipo escolhido.', 40),
  ('projetos.mao_obra.chave.gera_dsr', 'Chaves', 'Gera DSR', 'Marcado: esse valor gera descanso semanal remunerado. Vem pré-preenchido. A confirmar com o contador.', 'Soma 1/6 do valor (padrão) como DSR. Produção, comissão e hora extra geram; o fixo mensal já inclui.', 'Produção R$ 1.500 → DSR R$ 250', 'Marcar no fixo mensal. O DSR fica contado duas vezes.', 41),
  ('projetos.mao_obra.chave.13_ferias', 'Chaves', '13º/férias', 'Marcado: esse valor entra no 13º e nas férias.', 'Soma a provisão de 13º (8,33%) e de férias + 1/3 (11,11%) sobre o valor.', 'Fixo R$ 2.000 → provisões R$ 388,80', 'Desmarcar a produção habitual. Ela costuma entrar.', 42),
  ('projetos.mao_obra.chave.encargos', 'Chaves', 'INSS/FGTS', 'Marcado: sobre esse valor incidem INSS da empresa, RAT, terceiros e FGTS.', 'Soma os encargos da folha (%) sobre o valor, o DSR e as provisões.', '36,8% no Lucro Real', 'Desmarcar para "economizar". O custo real continua lá.', 43),
  ('projetos.mao_obra.chave.integra', 'Chaves', 'Integra a remuneração', 'Marcado: esse valor faz parte do salário para a lei.', 'Só valor que integra entra no DSR, nas provisões, nos encargos e na rescisão. Desmarcado, entra só pelo valor.', 'Bônus eventual: desmarcado', 'Desmarcar um valor pago todo mês. O custo fica baixo.', 44),
  ('projetos.mao_obra.chave.confirmadas', 'Chaves', 'Chaves conferidas com o contador', 'Marque depois que o contador confirmar as chaves desta ficha.', 'Não muda a conta. Mostra que as chaves foram checadas.', 'Marcado após ligação com o contador', 'Marcar sem falar com o contador.', 45),
  ('projetos.mao_obra.beneficio.vt', 'Benefícios', 'Vale-transporte', 'O que a empresa paga de vale no mês, já sem o desconto de 6% do salário.', 'Soma no custo mensal, sem encargos.', 'R$ 300', 'Colocar o valor cheio sem tirar os 6% que a pessoa paga.', 46),
  ('projetos.mao_obra.beneficio.alimentacao', 'Benefícios', 'Alimentação', 'O que a empresa gasta por mês com vale-refeição, cesta ou marmita.', 'Soma no custo mensal, sem encargos.', 'R$ 500', 'Esquecer o café da manhã na obra se a empresa paga.', 47),
  ('projetos.mao_obra.beneficio.saude', 'Benefícios', 'Plano de saúde', 'A parte que a empresa paga do plano, por mês.', 'Soma no custo mensal.', 'R$ 250', 'Colocar o valor total quando a pessoa paga uma parte.', 48),
  ('projetos.mao_obra.beneficio.seguro', 'Benefícios', 'Seguro de vida', 'O valor mensal do seguro por pessoa.', 'Soma no custo mensal.', 'R$ 15', 'Colocar o valor anual. Divida por 12.', 49),
  ('projetos.mao_obra.beneficio.epi', 'Benefícios', 'EPI e uniforme', 'O gasto médio por mês com equipamento de proteção e uniforme.', 'Soma no custo mensal.', 'R$ 40 (botina, luva, capacete divididos por mês)', 'Lançar a compra do ano inteiro num mês só.', 50),
  ('projetos.mao_obra.ficha.vigencia', 'Benefícios', 'Vale a partir de', 'O dia em que esses valores começam a valer.', 'O custo antigo fica no histórico até a véspera. Orçamentos novos usam o novo.', '01/05/2026 (dissídio)', 'Colocar uma data passada sem querer. O histórico muda de data.', 51),
  ('projetos.mao_obra.ficha.motivo', 'Benefícios', 'Motivo do reajuste', 'Por que o valor mudou.', 'Não entra na conta. Fica no histórico da ficha.', 'Dissídio 2026', 'Deixar em branco. Depois ninguém lembra por que mudou.', 52),
  ('projetos.mao_obra.ajuste.encargos', 'Ajustes', 'Encargos da folha % (nesta ficha)', 'Altere só se esta pessoa tem encargos diferentes do padrão da empresa.', 'Troca o % de encargos só nesta ficha. Fica registrado quem mudou e quando.', '40% em vez de 36,8%', 'Mudar aqui para corrigir a empresa toda. Use "Configurar padrões".', 53),
  ('projetos.mao_obra.ajuste.13', 'Ajustes', '13º % (nesta ficha)', 'Altere só se esta ficha precisa de outro %.', 'Troca a provisão de 13º só nesta ficha.', '8,33%', 'Mexer sem motivo. "Voltar ao padrão" desfaz.', 54),
  ('projetos.mao_obra.ajuste.ferias', 'Ajustes', 'Férias + 1/3 % (nesta ficha)', 'Altere só se esta ficha precisa de outro %.', 'Troca a provisão de férias só nesta ficha.', '11,11%', 'Esquecer o 1/3 de férias no %.', 55),
  ('projetos.mao_obra.ajuste.rescisao', 'Ajustes', 'Provisão de rescisão % (nesta ficha)', 'Altere só se esta ficha tem outra expectativa de rescisão.', 'Reserva por mês uma parte para a multa e o aviso quando a pessoa sair.', '4%', 'Zerar porque "ninguém sai". Sempre alguém sai.', 56),
  ('projetos.mao_obra.ajuste.dsr', 'Ajustes', 'DSR (nesta ficha)', 'A fração do descanso semanal. Padrão 1/6 (0,16667). A confirmar com o contador.', 'Multiplica os componentes que geram DSR.', '0,16667', 'Colocar 16,667 (como %). O campo é fração: 0,16667.', 57),
  ('projetos.mao_obra.resultado.mensal', 'Resultado', 'Custo mensal', 'Não se preenche. É o resultado.', 'Soma componentes, DSR, 13º e férias, encargos, rescisão e benefícios.', 'R$ 7.077 (exemplo da SPEC)', 'Comparar com o salário. O custo é bem maior que o salário.', 58),
  ('projetos.mao_obra.resultado.hora', 'Resultado', 'Custo da hora produtiva', 'Não se preenche. É o resultado.', 'Custo mensal ÷ horas produtivas. É o número que vai para o catálogo: custo da mão de obra do serviço = horas por unidade × custo da hora.', 'R$ 7.077 ÷ 176 h = R$ 40,21', 'Usar o valor da hora do salário no orçamento. O certo é este.', 59),
  ('projetos.mao_obra.resultado.unidade', 'Resultado', 'Custo por unidade produzida', 'Não se preenche. Aparece quando há produção.', 'Custo mensal ÷ volume médio. Função paga por produção pode usar este valor direto no catálogo.', 'R$ 7.077 ÷ 500 m² = R$ 14,15/m²', 'Confundir com o R$ por m² que a pessoa recebe (R$ 3,00).', 60),
  ('projetos.mao_obra.equipe.conferido', 'Equipe', 'Conferido', 'Marque só depois de checar com a folha ou o contrato.', 'Ficha não conferida não entra na média de custo da função.', 'Conferido com a folha de setembro', 'Conferir sem olhar a folha. Um erro entra na média de todos.', 61),
  ('projetos.mao_obra.encerrar.data', 'Equipe', 'Data do desligamento', 'O último dia de trabalho.', 'A partir dessa data a ficha sai da média. A demissão vai para o cadastro único.', '30/09/2026', 'Usar a data de hoje para quem saiu mês passado.', 62),
  ('projetos.mao_obra.encerrar.motivo', 'Equipe', 'Motivo', 'Por que a pessoa saiu ou o perfil foi inativado.', 'Não entra na conta. Fica no histórico. Nada é apagado.', 'Pedido de demissão', 'Escrever só "saiu".', 63),
  ('projetos.mao_obra.padrao.regime', 'Padrões', 'Regime tributário', 'Simples, Lucro Presumido ou Lucro Real, como o contador informar.', 'Define os encargos da folha que valem para todas as fichas da empresa.', 'Lucro Real', 'Escolher pelo palpite. Confirme com o contador.', 64),
  ('projetos.mao_obra.padrao.anexo', 'Padrões', 'Anexo do Simples', 'Só no Simples. O anexo em que a empresa recolhe.', 'Anexos III e V: o INSS da empresa já está no DAS (só FGTS na folha) e o RPA fica 0%. Anexo IV (obra): INSS e RAT fora do DAS.', 'Anexo IV (construção)', 'Marcar Anexo III para obra. O custo fica abaixo do real.', 65),
  ('projetos.mao_obra.padrao.inss', 'Padrões', 'INSS patronal %', 'O INSS que a empresa paga sobre a folha. Padrão 20%.', 'Entra nos encargos da folha.', '20%', 'Colocar o INSS descontado da pessoa (7,5% a 14%). Esse não é custo da empresa.', 66),
  ('projetos.mao_obra.padrao.rat', 'Padrões', 'RAT %', 'O seguro de acidente de trabalho: 1%, 2% ou 3% conforme a atividade.', 'Entra nos encargos, multiplicado pelo FAP.', '3% (obra)', 'Deixar 1% para obra.', 67),
  ('projetos.mao_obra.padrao.fap', 'Padrões', 'FAP', 'O fator que aumenta ou diminui o RAT (de 0,5 a 2,0). Vem na guia.', 'RAT × FAP entra nos encargos.', '1,00', 'Colocar como % (100). É um fator: 1,00.', 68),
  ('projetos.mao_obra.padrao.terceiros', 'Padrões', 'Terceiros %', 'Contribuições para Sesi, Senai, Sebrae e outros. Normalmente 5,8% fora do Simples.', 'Entra nos encargos da folha.', '5,8%', 'Colocar 5,8% no Simples. No Simples é 0%.', 69),
  ('projetos.mao_obra.padrao.fgts', 'Padrões', 'FGTS %', 'O depósito do FGTS. Padrão 8%.', 'Entra nos encargos da folha.', '8%', 'Somar a multa de 40% aqui. A multa está na provisão de rescisão.', 70),
  ('projetos.mao_obra.padrao.provisoes', 'Padrões', '13º %, férias + 1/3 % e rescisão %', 'As provisões padrão da empresa: 8,33%, 11,11% e 4%.', 'Valem para todas as fichas, salvo ajuste na ficha.', '8,33% · 11,11% · 4%', 'Esquecer o 1/3 das férias.', 71),
  ('projetos.mao_obra.padrao.vigencia', 'Padrões', 'Vale a partir de', 'O dia em que esses percentuais começam a valer.', 'Fichas e histórico usam o padrão vigente em cada data.', '01/01/2026', 'Mudar o passado sem querer.', 72),
  ('projetos.mao_obra.padrao.desoneracao', 'Padrões', 'Desoneração da folha (CPRB)', 'Marque se a empresa está na desoneração e paga INSS sobre a receita.', 'Só parte do INSS patronal fica na folha (2026: 50%). A CPRB vai para os impostos da venda, não para a hora.', '2026: 50% do INSS na folha', 'Pôr a CPRB no custo da hora.', 73),
  ('projetos.mao_obra.padrao.horas', 'Padrões', 'Horas produtivas/mês (padrão)', 'O número que vem pronto em toda ficha nova. Padrão 176.', 'Divide o custo mensal em cada ficha nova.', '176', 'Usar 220.', 74),
  ('projetos.mao_obra.padrao.vinculo_forma', 'Padrões', 'Vínculo e forma de pagamento (padrão)', 'O que vem pronto na ficha nova.', 'Não muda conta. Economiza digitação.', 'CLT · mensal', 'Achar que muda fichas já salvas. Só vale para as novas.', 75),
  ('projetos.mao_obra.padrao.beneficios', 'Padrões', 'Benefícios padrão', 'Os valores de vale, alimentação, plano, seguro e EPI que vêm prontos na ficha nova.', 'Somam no custo de cada ficha nova (pode mudar na ficha).', 'VT R$ 300 · Alimentação R$ 500', 'Achar que muda fichas já salvas.', 76),
  ('projetos.mao_obra.padrao.dsr', 'Padrões', 'DSR (fração do mês)', 'Padrão 1/6 (0,16667). A confirmar com o contador.', 'Multiplica produção, comissão e hora extra de CLT.', '0,16667', 'Colocar como % (16,667).', 77),
  ('projetos.mao_obra.padrao.rpa', 'Padrões', 'INSS do autônomo (RPA) %', 'O INSS que a empresa paga sobre autônomo e diarista. Em branco segue a regra do regime.', 'Soma esse % sobre o valor pago a RPA e diarista.', '20% · Simples Anexo III/V: 0%', 'Deixar 20% no Simples III/V. Lá já está no DAS.', 78),
  ('projetos.mao_obra.padrao.salario_minimo', 'Padrões', 'Salário mínimo de referência', 'O salário mínimo vigente.', 'É a base da insalubridade.', 'R$ 1.518', 'Esquecer de atualizar em janeiro.', 79),
  ('projetos.mao_obra.padrao.chaves', 'Padrões', 'Chaves por tipo de componente', 'Quais encargos cada tipo de componente leva na CLT. Vem com o padrão. A confirmar com o contador.', 'Pré-preenchem as chaves de cada componente nas fichas novas.', 'Produção: gera DSR, 13º/férias, INSS/FGTS, integra', 'Mudar sem o contador.', 80),
  ('projetos.mao_obra.padrao.confirmado', 'Padrões', 'O contador confirmou', 'Marque só depois que o contador conferir os percentuais e regras.', 'Tira o aviso de "provisório" dos encargos.', 'Marcado após e-mail do contador', 'Marcar para tirar o aviso sem confirmar.', 81)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;

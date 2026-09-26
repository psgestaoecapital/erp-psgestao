-- RD CATALOGO — fonte unica das Regras de Diretriz (decisao CEO 26/09; auditoria das RDs 25/09)
-- Numero automatico (fn_rd_registrar), tier (lei/protocolo/licao), gate declarado, substituida_por com rastro.
-- fn_briefing_sessao passa a ler daqui. Estrela Polar §2 vira export.

CREATE TABLE IF NOT EXISTS public.erp_rd_catalogo (
  numero          int NOT NULL,
  sufixo          text NOT NULL DEFAULT '',          -- 'b' para 43b/44b (legado); novas nunca usam sufixo
  versao          int NOT NULL DEFAULT 1,
  titulo          text NOT NULL,
  texto           text NOT NULL,
  tier            text NOT NULL CHECK (tier IN ('lei','protocolo','licao')),
  gate_tipo       text NOT NULL DEFAULT 'nenhum' CHECK (gate_tipo IN ('ci','banco','processo','nenhum')),
  gate            text,                              -- ex.: check_fn_guards, fn_briefing_sessao, aceitacao-pr.yml
  status          text NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente','substituida','retirada','proposta')),
  substituida_por int,
  motivo_retirada text,
  origem          text,                              -- contexto/data/sessao em que nasceu
  contexto_id     uuid,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (numero, sufixo)
);
COMMENT ON TABLE public.erp_rd_catalogo IS 'FONTE UNICA das RDs. Nova RD so via fn_rd_registrar (numero automatico). Regra fora daqui nao e regra. Estrela Polar §2 = export desta tabela.';
ALTER TABLE public.erp_rd_catalogo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rd leitura admin" ON public.erp_rd_catalogo;
CREATE POLICY "rd leitura admin" ON public.erp_rd_catalogo FOR SELECT TO authenticated USING (is_admin());

-- numero automatico: nenhuma Claude escolhe numero
CREATE OR REPLACE FUNCTION public.fn_rd_registrar(p_titulo text, p_texto text, p_tier text, p_gate_tipo text DEFAULT 'nenhum', p_gate text DEFAULT NULL, p_origem text DEFAULT NULL, p_contexto_id uuid DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_num int;
BEGIN
  -- so admin (D1=B, PR #1810). auth.uid() IS NOT NULL: sem sessao (migration 120000, MCP) is_admin() e false — provado — e a REVOKE abaixo ja fecha anon.
  IF auth.uid() IS NOT NULL AND NOT is_admin() THEN RAISE EXCEPTION 'só admin'; END IF;
  IF p_tier NOT IN ('lei','protocolo','licao') THEN RAISE EXCEPTION 'tier invalido: %', p_tier; END IF;
  IF p_gate_tipo <> 'nenhum' AND nullif(btrim(coalesce(p_gate,'')),'') IS NULL THEN RAISE EXCEPTION 'gate_tipo % exige o nome do gate', p_gate_tipo; END IF;
  SELECT greatest(coalesce(max(numero),0), 78) + 1 INTO v_num FROM erp_rd_catalogo;
  INSERT INTO erp_rd_catalogo(numero, titulo, texto, tier, gate_tipo, gate, origem, contexto_id)
  VALUES (v_num, p_titulo, p_texto, p_tier, p_gate_tipo, p_gate, p_origem, p_contexto_id);
  RETURN v_num;
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_rd_registrar(text, text, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_rd_registrar(text, text, text, text, text, text, uuid) TO authenticated, service_role;

-- substituir/retirar com rastro (nunca DELETE) · plpgsql para poder RAISE 'só admin' (D1=B)
CREATE OR REPLACE FUNCTION public.fn_rd_substituir(p_numero int, p_por int, p_motivo text, p_sufixo text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_admin() THEN RAISE EXCEPTION 'só admin'; END IF;
  UPDATE erp_rd_catalogo SET status = CASE WHEN p_por IS NULL THEN 'retirada' ELSE 'substituida' END,
         substituida_por = p_por, motivo_retirada = p_motivo, atualizado_em = now()
  WHERE numero = p_numero AND sufixo = p_sufixo;
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_rd_substituir(integer, integer, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_rd_substituir(integer, integer, text, text) TO authenticated, service_role;

-- bloco para o briefing
CREATE OR REPLACE FUNCTION public.fn_rd_briefing() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'fonte', 'erp_rd_catalogo (fonte unica; nova RD so via fn_rd_registrar)',
    'total_vigentes', (SELECT count(*) FROM erp_rd_catalogo WHERE status='vigente'),
    'leis', (SELECT coalesce(jsonb_agg(jsonb_build_object('rd', 'RD-'||numero||sufixo, 'titulo', titulo, 'gate', coalesce(gate,'NENHUM')) ORDER BY numero), '[]') FROM erp_rd_catalogo WHERE status='vigente' AND tier='lei'),
    'protocolos', (SELECT coalesce(jsonb_agg(('RD-'||numero||sufixo||' '||titulo) ORDER BY numero), '[]') FROM erp_rd_catalogo WHERE status='vigente' AND tier='protocolo'),
    'leis_sem_gate', (SELECT coalesce(jsonb_agg(('RD-'||numero||sufixo||' '||titulo) ORDER BY numero), '[]') FROM erp_rd_catalogo WHERE status='vigente' AND tier='lei' AND gate_tipo='nenhum'),
    'novas_30d', (SELECT coalesce(jsonb_agg(('RD-'||numero||sufixo||' '||titulo) ORDER BY numero), '[]') FROM erp_rd_catalogo WHERE status='vigente' AND criado_em > now() - interval '30 days' AND numero > 78),
    'propostas', (SELECT coalesce(jsonb_agg(('RD-'||numero||sufixo||' '||titulo) ORDER BY numero), '[]') FROM erp_rd_catalogo WHERE status='proposta')
  )
$$;

-- prontuario -> alertas do briefing (empresas reais com algo faltando)
CREATE OR REPLACE FUNCTION public.fn_prontuario_alertas() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('empresa', razao_social, 'fiscal', fiscal_faltando, 'banco', banco_faltando, 'a1_dias', a1_dias_restantes) ORDER BY razao_social), '[]')
  FROM v_prontuario_conexao
  WHERE NOT coalesce(is_demo,false) AND (fiscal_provider IS NOT NULL OR banco_ativo IS NOT NULL)
    AND (cardinality(fiscal_faltando) > 0 OR cardinality(banco_faltando) > 0)
$$;

-- ---------- SEED (auditoria 25/09: vigentes + retiradas com rastro) ----------
INSERT INTO public.erp_rd_catalogo (numero, sufixo, titulo, texto, tier, gate_tipo, gate, status, substituida_por, motivo_retirada, origem) VALUES
-- LEIS
(18,'','Status validos em erp_contexto_projeto','Somente os status do CHECK da tabela.','lei','banco','CHECK erp_contexto_projeto.status','vigente',NULL,NULL,'09/05'),
(25,'','Decisoes comerciais e dos 6 Grupos Protegidos sao exclusivas do CEO','Precificacao, planos, contratos, comunicacao com cliente: so o CEO decide.','lei','nenhum',NULL,'vigente',NULL,NULL,'10/05'),
(28,'','Auditores notificam o Eng. Chefe pos-merge','Truth/Playwright/Insight/Manual Vivo por cron; resultado ausente no prazo = cinza, nunca verde.','lei','banco','cron 27/28/30/31/32 + fn_briefing_sessao','vigente',NULL,NULL,'11/05'),
(30,'','Nao deletar: arquivar. Nao dropar tabela vazia','Tabela vazia pode estar em reserva.','lei','nenhum',NULL,'vigente',NULL,NULL,'11/05'),
(33,'','Areas/planos permanentemente visiveis no menu','Numero oficial pendente de decisao do CEO: regra diz 12, banco tem 15 com visivel_sempre, fn_listar_areas_visiveis nao le a coluna.','lei','banco','visivel_sempre (divergente desde 02/09)','vigente',NULL,NULL,'11/05'),
(34,'','Code Web usa gh CLI nativo; nunca GraphQL do MCP GitHub','V5: merge via gh pr merge; branch protection na main.','lei','processo','branch protection main','vigente',NULL,NULL,'11/05 · V5 25/05'),
(35,'','Visao total antes de desenvolver: briefing no inicio, handoff no fim, trigger de tela orfa','fn_briefing_sessao + fn_gold_relatorio_diario obrigatorios; fn_registrar_handoff ao fim.','lei','banco','fn_briefing_sessao / trigger tela orfa','vigente',NULL,NULL,'11/05'),
(38,'','Verdade absoluta: nunca declarar entregue sem prova empirica','Mergeado != funciona. Prova por RPC != prova na tela do usuario certo.','lei','banco','Truth Auditor (camadas 1-4)','vigente',NULL,NULL,'24/05'),
(39,'','Eng. Chefe nunca propoe pausa/handoff; CEO controla o ritmo','Absorve RD-23 e RD-32.','lei','nenhum',NULL,'vigente',NULL,NULL,'24/05'),
(41,'','Fluxo oficial: SPEC -> CEO cola no Code Web -> jornada verde no preview -> merge -> Eng. audita producao -> link clicavel da PR','Passo "jornada verde" adicionado pela RD-78.','lei','ci','aceitacao-pr.yml + check_menu + check_fn_guards','vigente',NULL,NULL,'28/05 · 26/09'),
(42,'','Zero custo recorrente ate o cliente bancar','Constroi tudo; ativa custos por ultimo. Absorve o texto original da RD-39 (custo zero pre-receita).','lei','nenhum',NULL,'vigente',NULL,NULL,'02/06'),
(45,'','Diagnostico de tenant sempre escopado por company_id','service_role/MCP mascaram RLS.','lei','nenhum',NULL,'vigente',NULL,NULL,'13/07'),
(50,'','Tela sem menu nao e tela','Toda rota pronta tem item de menu e feature linkada.','lei','ci','check_menu','vigente',NULL,NULL,'14/07'),
(51,'','LEI-MAE: o desconhecido nunca e "OK"','Mostra cru, declara que nao sabe, nao avanca. Absorve RD-40 (anti-lixo) e RD-58 (badge que mente).','lei','nenhum',NULL,'vigente',NULL,NULL,'14/07'),
(52,'','Config que nao corresponde ao comportamento real e mentira silenciosa; uma fonte de verdade','Vocabulario: "RD-52" NAO e apelido de deploy-migrations.','lei','nenhum',NULL,'vigente',NULL,NULL,'14/07'),
(53,'','Nao-regressao: o CEO nao e o teste de regressao','Gate real = RD-78 (banco de regressao em e2e/jornadas/aceitacao).','lei','ci','check_fn_guards + aceitacao-pr.yml','vigente',NULL,NULL,'14/07'),
(54,'','Dados reais: backup antes, escopado, em transacao, rename antes de drop','Absorve RD-37 (snapshot antes de onda).','lei','nenhum',NULL,'vigente',NULL,NULL,'15/07'),
(55,'','Perda de dado de cliente = multa contratual. Padrao ADITIVO. Nunca tocar parcela/titulo pago','INVIOLAVEL.','lei','nenhum',NULL,'vigente',NULL,NULL,'20/07'),
(56,'','Branch nova por PR, sempre a partir da main','Branch serial travando entrega e problema de processo.','lei','processo','branch protection','vigente',NULL,NULL,'V13'),
(59,'','Fluxo fiscal so esta PRONTO depois de UMA emissao real autorizada','Vale para NF-e, NFC-e, NFS-e, CT-e, cancelamento, CC-e, devolucao, MDF-e. O prontuario marca "nenhuma emissao real autorizada".','lei','banco','v_prontuario_conexao.fiscal_faltando','vigente',NULL,NULL,'11/09'),
(69,'','Uma empresa de demonstracao por vertical, com dados ficticios e casos negativos','Auditoria, testes e apresentacao rodam nela; empresa real nunca e clicada.','lei','banco','companies.is_demo','vigente',NULL,NULL,'19/09'),
(70,'','Consultar a memoria antes de investigar erro com codigo','Catalogos primeiro (erp_fiscal_erro_catalogo, erp_banco_erro_catalogo), depois erp_contexto_projeto. Causa sem prova descrita e hipotese.','lei','banco','fn_fiscal_erro_traduzir','vigente',NULL,NULL,'25/09'),
(71,'','Dois caminhos para a mesma coisa: a correcao vai so em um. Varrer o irmao antes de fechar','Absorve RD-57. Provado 4x em 25/09 (3 caminhos do builder da NF-e).','lei','nenhum',NULL,'vigente',NULL,NULL,'25/09'),
(72,'','Campo fiscal so entra com a fonte citada (MOC, NT, leiaute, resposta oficial do provedor)','Leiaute NFS-e Nacional offline ainda e divida.','lei','nenhum',NULL,'vigente',NULL,NULL,'25/09'),
(73,'','Documento autorizado e a verdade; informacao verbal complementa, nunca substitui','Caso IM 6617.','lei','nenhum',NULL,'vigente',NULL,NULL,'25/09'),
(74,'','Cadastro aceito e cadastro que funciona: validar na entrada, rejeitar com mensagem que ensina','Certificado ilegivel 16 dias "ativo"; 2.962 cadastros sem documento com "0 erros".','lei','nenhum',NULL,'vigente',NULL,NULL,'25/09'),
(76,'','Cruzar timestamp e company_id antes de afirmar causa','Dado criado depois do erro nao pode ser a causa.','lei','nenhum',NULL,'vigente',NULL,NULL,'25/09'),
(78,'','Prova automatica de aceitacao: nenhuma PR mergeia sem jornada verde no preview; nenhum chamado vai a "aguardando seu teste" sem jornada verde em producao','Toda SPEC entrega o seu .spec.ts em e2e/jornadas/aceitacao (banco de regressao).','lei','ci','aceitacao-pr.yml (PR #1808)','vigente',NULL,NULL,'25/09'),
-- PROTOCOLOS
(13,'','Templates SQL nao usam << >> como placeholder','Confunde o CEO no mobile.','protocolo','nenhum',NULL,'vigente',NULL,NULL,'08/05'),
(20,'','Pacote para o Code Web = 1 bloco unico, autocontido','Nunca fragmentar.','protocolo','nenhum',NULL,'vigente',NULL,NULL,'10/05'),
(26,'','Auditar antes de criar: schema, RPCs, telas, constraints, package.json','Vale para o Eng. Chefe. Absorve RD-10/11/12.','protocolo','banco','fn_detectar_drift','vigente',NULL,NULL,'10/05'),
(43,'','Cada avanco concreto registrado imediatamente em erp_contexto_projeto; fechar ao resolver','Absorve RD-44b (higiene) e a "sincronia" original da RD-59.','protocolo','nenhum',NULL,'vigente',NULL,NULL,'V13 · 13/07'),
(43,'b','Decisao exposta ao CEO segura a PR em draft ate a resposta','Pratica confirmada no #1806.','protocolo','processo','PR draft','vigente',NULL,NULL,'07/09'),
(44,'','Memoria e hipotese, nao verdade; CEO diz "isso mudou" -> ele esta certo por padrao','Verificar antes de decidir.','protocolo','nenhum',NULL,'vigente',NULL,NULL,'13/07'),
(48,'','Ingestao exaustiva + cruzamento automatico','Importador universal.','protocolo','nenhum',NULL,'vigente',NULL,NULL,'14/07'),
(60,'','Correcao cirurgica > solucao robusta que roda em toda escrita','Trigger em tabela financeira roda para todas as empresas.','protocolo','nenhum',NULL,'vigente',NULL,NULL,'11/09'),
(61,'','Blindar antes de criar o estado','Novo valor em CHECK que alimenta somatorios: blindar as somas primeiro.','protocolo','nenhum',NULL,'vigente',NULL,NULL,'11/09'),
(62,'','Urgencia nao e alavanca para aprovar o que nao se entende','A dependencia e o problema, nao a revisao.','protocolo','nenhum',NULL,'vigente',NULL,NULL,'11/09'),
(63,'','Foto velha e arqueologia, nao diagnostico','Insight mostra a idade da captura.','protocolo','banco','idade da foto no Insight','vigente',NULL,NULL,'18/09'),
(64,'','"Nao testado" != "quebrado": veredito neutro obrigatorio','Vermelho que nao e vermelho ensina a ignorar vermelho.','protocolo','nenhum',NULL,'vigente',NULL,NULL,'18/09'),
(65,'','Duas validacoes para a mesma regra = uma vai envelhecer. Fonte unica','Caso CNO em fn_receber_nfse_dados.','protocolo','nenhum',NULL,'vigente',NULL,NULL,'18/09'),
(66,'','Campo interno nunca vaza para documento legal','observacoes do titulo nao vai na nota.','protocolo','nenhum',NULL,'vigente',NULL,NULL,'18/09'),
(67,'','O que o sistema envia precisa ficar gravado','payload_enviado em toda integracao.','protocolo','banco','payload_enviado (nfe/nfse)','vigente',NULL,NULL,'18/09'),
(68,'','O titulo precisa saber como foi baixado (origem_baixa)','CNAB, conciliacao, manual, permuta, dinheiro, boleto.','protocolo','banco','erp_receber.origem_baixa','vigente',NULL,NULL,'18/09'),
(75,'','Trava vale quando a consequencia e imediata; futura e invisivel = avisar primeiro','Trava sem consequencia percebida vira obstaculo.','protocolo','nenhum',NULL,'vigente',NULL,NULL,'25/09'),
(77,'','Onboarding que falha em silencio nao e self-service','Coluna 100% vazia = mapeamento errado; cada passo avisa o que nao funcionou.','protocolo','nenhum',NULL,'vigente',NULL,NULL,'25/09'),
-- LICOES (vao para o Manual Vivo; ficam aqui so para rastro)
(9,'','MCP e transacao','Superada: provado em 25/09 que BEGIN READ ONLY funciona via MCP.','licao','nenhum',NULL,'retirada',NULL,'obsoleta (provado o contrario em 25/09)','08/05'),
(14,'','Triggers cross-schema auth->public exigem split de transacao','Armadilha Postgres.','licao','nenhum',NULL,'vigente',NULL,NULL,'09/05'),
(15,'','Validar contagem aritmetica em NOTICEs de auditoria','Armadilha.','licao','nenhum',NULL,'vigente',NULL,NULL,'09/05'),
(16,'','CHECK constraints sobrevivem a RENAME com o nome antigo','Armadilha Postgres.','licao','nenhum',NULL,'vigente',NULL,NULL,'09/05'),
(17,'','Constraints DEFERRABLE nao podem ser arbitros de ON CONFLICT','Armadilha Postgres.','licao','nenhum',NULL,'vigente',NULL,NULL,'09/05'),
(19,'','IF NOT EXISTS pode ser no-op se a tabela legada existe com schema diferente','Armadilha Postgres.','licao','nenhum',NULL,'vigente',NULL,NULL,'09/05'),
(46,'','BI multi-fonte: numeros diferentes com o mesmo rotulo = granularidade','Licao de desenho.','licao','nenhum',NULL,'vigente',NULL,NULL,'13/07'),
(47,'','Reuso != enfiar na tabela errada: CATALOGO != STORE','Licao de desenho.','licao','nenhum',NULL,'vigente',NULL,NULL,'13/07'),
(49,'','Divergencia e dado, nao excecao','Licao de desenho.','licao','nenhum',NULL,'vigente',NULL,NULL,'14/07'),
-- RETIRADAS / SUBSTITUIDAS (rastro)
(10,'','Auditar constraints antes de adicionar','-','protocolo','nenhum',NULL,'substituida',26,'absorvida pela RD-26','08/05'),
(11,'','Auditar package.json antes de listar dependencias','-','protocolo','nenhum',NULL,'substituida',26,'absorvida pela RD-26','08/05'),
(12,'','Auditar schema real antes de gerar spec','-','protocolo','nenhum',NULL,'substituida',26,'absorvida pela RD-26','08/05'),
(22,'','Coordenacao MCP x Code Web','-','protocolo','nenhum',NULL,'retirada',NULL,'superada pelo Contrato de Operacao das instrucoes fixas','10/05'),
(23,'','Decisao de pausa e exclusiva do CEO','-','lei','nenhum',NULL,'substituida',39,'mesma regra da RD-39','10/05'),
(24,'','Pulse de status no fim da conversa','-','protocolo','nenhum',NULL,'substituida',35,'handoff da RD-35','10/05'),
(27,'','Visual check antes de UI (proposta)','-','protocolo','nenhum',NULL,'retirada',NULL,'nunca ratificada; coberta por RD-70/78','10/05'),
(29,'','Product Insight Auditor backend pronto','-','licao','nenhum',NULL,'retirada',NULL,'era marco, nao regra','11/05'),
(31,'','Protocolo de abertura deep','-','protocolo','nenhum',NULL,'substituida',35,'fundida na RD-35','11/05'),
(32,'','Eng. Chefe nao sugere pausa','-','lei','nenhum',NULL,'substituida',39,'mesma regra da RD-39','11/05'),
(36,'','Auditor on-demand obrigatorio pos-merge','-','lei','nenhum',NULL,'substituida',78,'coberta por RD-70 + RD-78','13/05'),
(37,'','Snapshot Supabase antes de cada onda (colidia com "paridade Conta Azul")','-','lei','nenhum',NULL,'substituida',54,'absorvida pela RD-54; "paridade" e estrategia (§1 da Estrela)','14/05'),
(40,'','Merge direto + auditores validam main (colidia com "anti-lixo")','-','lei','nenhum',NULL,'substituida',78,'merge direto superado pela RD-78; anti-lixo absorvido pela RD-51','23/05'),
(44,'b','Higiene de memoria: fechar o contexto ao resolver','-','protocolo','nenhum',NULL,'substituida',43,'fundida na RD-43','13/07'),
(57,'','Trava nova testada em todos os caminhos','-','protocolo','nenhum',NULL,'substituida',71,'irma da RD-71','V13'),
(58,'','Badge que mente e RD-51','-','licao','nenhum',NULL,'substituida',51,'e a RD-51 aplicada ao menu','V13')
ON CONFLICT (numero, sufixo) DO UPDATE SET titulo=EXCLUDED.titulo, texto=EXCLUDED.texto, tier=EXCLUDED.tier, gate_tipo=EXCLUDED.gate_tipo, gate=EXCLUDED.gate,
  status=EXCLUDED.status, substituida_por=EXCLUDED.substituida_por, motivo_retirada=EXCLUDED.motivo_retirada, origem=EXCLUDED.origem, atualizado_em=now();

-- ---------- fn_briefing_sessao passa a expor rd_catalogo + prontuario_conexao_alertas (patch idempotente) ----------
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname='fn_briefing_sessao';
  IF v_def ~ 'rd_catalogo' THEN RETURN; END IF;   -- ja aplicado
  v_new := replace(v_def, E'  RETURN v_result;\nEND;',
    E'  -- 26/09: fonte unica das RDs (erp_rd_catalogo) + prontuario de conexao (fiscal/banco por empresa)\n  v_result := v_result || jsonb_build_object(''rd_catalogo'', fn_rd_briefing(), ''prontuario_conexao_alertas'', fn_prontuario_alertas());\n  RETURN v_result;\nEND;');
  IF v_new = v_def THEN RAISE EXCEPTION 'fn_briefing_sessao: ancora RETURN v_result nao encontrada'; END IF;
  EXECUTE v_new;
END $do$;

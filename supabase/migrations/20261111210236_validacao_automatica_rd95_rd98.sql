-- Compliance · Validação Automática (/dashboard/compliance/validacao-automatica) · aud8 (tarefa e290fb7b)
-- A tela era um placeholder "em construção" (RD-98 p1): o backend já existe (APIs /api/compliance/consultas e
-- /api/compliance/worker, idempotentes via fn_compliance_enfileirar_consulta). Este PR entrega a tela FUNCIONAL
-- (histórico + indicadores + consulta avulsa). Esta migration é ADITIVA/idempotente, NÃO altera dado de cliente:
--  (1) RD-95 "?": cadastra as chaves de ajuda de todos os campos/filtros/colunas/ações/indicadores da tela;
--  (2) RD-98 p3: registra a origem do dado em system_screens (views_consumidas/rpcs_chamadas).
-- Faixa de migration do code-desenvolvedor-3 (segundos :36), acima da main.

-- ── (1) RD-95: chaves de ajuda ──────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/compliance/validacao-automatica', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('compliance.validacao.kpi.total','Indicadores','Consultas','Total de validações já disparadas para esta empresa.','Dá a dimensão do histórico de certidões consultadas.','"128" = 128 consultas guardadas.','—',1),
 ('compliance.validacao.kpi.sem_pendencia','Indicadores','Sem pendências','Quantas consultas voltaram negativas (sem débito).','Mostra quanto está regular — certidão negativa é o resultado desejado.','CNDT negativa = sem débito trabalhista.','—',2),
 ('compliance.validacao.kpi.com_pendencia','Indicadores','Com pendências','Quantas consultas acusaram débito/positiva.','Prioriza o que precisa de regularização.','Positiva com efeito de negativa também entra aqui.','—',3),
 ('compliance.validacao.kpi.pendente','Indicadores','Processando','Consultas enfileiradas que o robô ainda não terminou.','Avisa que há resultado a caminho — atualize em instantes.','Acabou de disparar? Fica aqui até o robô responder.','—',4),
 ('compliance.validacao.kpi.indisponivel','Indicadores','Indisponível','Consultas que não puderam concluir (CAPTCHA do portal ou erro).','Separa o que depende de integração licenciada (RFB/Caixa) do que já funciona.','CND Federal fica indisponível até a API licenciada.','—',5),
 ('compliance.validacao.acao.consultar','Ações','Nova consulta','Dispara uma consulta de certidão para um documento.','Enfileira a validação; o robô busca no portal oficial e guarda o resultado.','CNDT de um CNPJ volta em segundos.','Consulta repetida em <24h é reaproveitada (não duplica).',6),
 ('compliance.validacao.consulta.tipo','Nova consulta','Tipo','A quem pertence o documento consultado.','Classifica a consulta (empresa, funcionário, fornecedor…) para filtrar depois.','"Minha empresa" valida o CNPJ da própria empresa.','Use "Avulso" para um documento fora dos cadastros.',7),
 ('compliance.validacao.consulta.documento','Nova consulta','CPF/CNPJ','O documento a consultar: 11 dígitos (CPF) ou 14 (CNPJ).','É a chave da consulta no portal oficial.','12.345.678/0001-90 ou só os números.','Documento incompleto ou com dígito a mais é recusado.',8),
 ('compliance.validacao.consulta.provedor','Nova consulta','Provedor','Qual certidão consultar.','Define o órgão: CNDT (TST), CND Federal (RFB) ou CRF FGTS (Caixa).','CNDT = débitos trabalhistas.','RFB/Caixa ficam indisponíveis (CAPTCHA) até integração licenciada.',9),
 ('compliance.validacao.consulta.nome','Nova consulta','Nome (opcional)','Um rótulo para reconhecer o alvo na lista.','Facilita achar a consulta depois sem decorar o documento.','"Fornecedor ABC".','Opcional — não afeta a consulta.',10),
 ('compliance.validacao.busca','Filtros','Buscar','Parte do nome ou do documento do alvo.','Encontra uma consulta específica sem rolar a lista.','"abc" ou "0001" filtra na hora.','Busca por documento ignora pontuação.',11),
 ('compliance.validacao.filtro.provedor','Filtros','Provedor','Mostra só as consultas de um provedor.','Separa CNDT de CND Federal/FGTS.','"CNDT" lista só as trabalhistas.','—',12),
 ('compliance.validacao.filtro.status','Filtros','Situação','Filtra pelo desfecho da consulta.','Acha rápido o que está com pendência ou ainda processando.','"Com pendências" lista o que regularizar.','—',13),
 ('compliance.validacao.acao.atualizar','Ações','Atualizar','Recarrega a lista com os resultados mais novos.','Traz o desfecho das consultas que o robô terminou de processar.','Clique após disparar uma consulta nova.','—',14),
 ('compliance.validacao.col.provedor','Colunas','Provedor','Órgão/certidão da linha.','Identifica o tipo de certidão.','CNDT, CND Federal, CRF FGTS.','—',15),
 ('compliance.validacao.col.alvo','Colunas','Alvo','Nome (se informado) e documento consultado.','Mostra de quem é a certidão.','"Fornecedor ABC — 12.345.678/0001-90".','—',16),
 ('compliance.validacao.col.status','Colunas','Situação','Desfecho: sem pendências, com pendências, processando, indisponível ou não concluída.','Diz se há o que tratar.','"Sem pendências" = certidão negativa.','"Indisponível" = portal com CAPTCHA, não é erro da empresa.',17),
 ('compliance.validacao.col.numero','Colunas','Certidão nº','Número da certidão emitida, quando houver.','Serve de comprovante/rastreio.','Número impresso na certidão.','Vazio enquanto a consulta não concluiu.',18),
 ('compliance.validacao.col.validade','Colunas','Validade','Até quando a certidão vale.','Avisa quando reconsultar.','Certidão vence; reconsulte perto da data.','Sem validade = ainda não emitida.',19),
 ('compliance.validacao.col.quando','Colunas','Consultado','Data e hora em que a consulta foi feita.','Mostra quão recente é o resultado.','"10/11/2026 14:32".','—',20)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);

-- ── (2) RD-98 p3: origem do dado da tela ────────────────────────────────────────────────────────────────────────
UPDATE public.system_screens
SET views_consumidas = ARRAY['compliance_consultas']::text[],
    rpcs_chamadas = ARRAY['fn_compliance_enfileirar_consulta','fn_ajuda_campo_listar']::text[]
WHERE rota = '/dashboard/compliance/validacao-automatica'
  AND (views_consumidas IS NULL OR rpcs_chamadas IS NULL);

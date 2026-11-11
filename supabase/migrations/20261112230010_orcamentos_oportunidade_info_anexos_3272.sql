-- Chamado #3272 (Tryo, HB2) · "Editar orçamento": ver os anexos e dados que o vendedor colocou na oportunidade.
-- A orçamentista precisava voltar ao funil → Oportunidades → editar só para ver os anexos. Agora o bloco
-- "Informações da oportunidade" dentro de Editar orçamento mostra, sem sair da tela, a localização (link do mapa),
-- a descrição/observações, as anotações da visita e os ANEXOS do vendedor (abrir/baixar, somente leitura).
--
-- RD-94.1 (c) ADITIVO: esta migration só REGISTRA o texto do "?" (RD-95) do bloco em erp_ajuda_campo.
-- Não cria/altera tabela, RLS, policy, grant ou RPC; os anexos são lidos pela RPC já existente
-- (fn_crm_anexos_listar) e o componente AnexosCard em modo somente leitura.
-- Plano de volta: DELETE da chave de ajuda (o bloco continua funcionando sem o "?").

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/orcamentos', 'hub_projetos', 'publicado'
FROM (VALUES
 ('orcamentos.oportunidade.info', 'Informações da oportunidade', 'Informações da oportunidade',
  'Nada a preencher: bloco somente leitura que aparece quando o orçamento veio de uma oportunidade. Mostra cliente, responsável, localização da obra (com link para o mapa), observações, anotações da visita e os anexos que o vendedor enviou (clique para abrir ou baixar).',
  'Deixa a orçamentista ver, sem sair da tela, os arquivos e dados que o vendedor registrou na oportunidade — antes era preciso voltar ao funil, achar a oportunidade e editá-la só para ver o anexo.',
  'Ao montar o orçamento, abra um anexo (planta em PDF/DWG, fotos) e confira as observações do vendedor sem perder o que já digitou.',
  'Esperar editar a oportunidade por aqui: este bloco é só de leitura; para mudar a oportunidade, use o link do mapa ou a tela de Oportunidades.', 1)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- RD-69 · DEMO (fictício): dá 2 anexos-exemplo (links) à oportunidade DEMO que já tem orçamento vinculado,
-- para o bloco "Informações da oportunidade" demonstrar abrir/baixar sem sair da tela (aceite do #3272).
-- Só em empresa is_demo; idempotente (NOT EXISTS por url). NUNCA toca dado de cliente real nem de produção.
INSERT INTO public.erp_crm_anexo (company_id, oportunidade_id, tipo, categoria, descricao, ordem, url, nome_arquivo)
SELECT o.company_id, o.id, 'link', v.categoria, v.descricao, v.ordem, v.url, v.nome
FROM public.erp_crm_oportunidade o
JOIN public.companies c ON c.id = o.company_id AND c.is_demo = true
CROSS JOIN (VALUES
  ('planta',    'Planta baixa enviada pelo vendedor (exemplo DEMO)',       1, 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', 'Planta-baixa-exemplo.pdf'),
  ('documento', 'Memorial descritivo enviado pelo vendedor (exemplo DEMO)', 2, 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', 'Memorial-descritivo-exemplo.pdf')
) AS v(categoria, descricao, ordem, url, nome)
WHERE o.orcamento_id IS NOT NULL AND o.deleted_at IS NULL
  AND o.titulo = 'Piso industrial – Frigorífico Oeste'
  AND NOT EXISTS (
    SELECT 1 FROM public.erp_crm_anexo a
    WHERE a.oportunidade_id = o.id AND a.url = v.url AND a.deleted_at IS NULL
  );

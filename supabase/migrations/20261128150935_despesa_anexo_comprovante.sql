-- Financeiro · Nova despesa (/dashboard/financeiro/nova-despesa) — ANEXO/COMPROVANTE do pagamento.
-- PDCA auditor_pdca_2 (22/11, blueprint 206, RD-38): a tela não deixava anexar o comprovante/nota do
-- pagamento (NovaDespesaForm sem campo de upload; erp_pagar sem coluna de anexo). Esta migration abre o
-- caminho de dados: coluna no título + bucket privado por empresa + texto do "?" (RD-95). A UI entra na
-- mesma PR (NovaDespesaForm + ComprovantePagar.tsx).
-- Code: code-desenvolvedor-3
--
-- ADITIVA e idempotente: só ACRESCENTA colunas, bucket e policies NOVAS; não toca RLS/grants existentes,
-- não altera/apaga nenhum dado de cliente. REVOKE anon implícito (policies só para 'authenticated').
-- Isolamento por empresa (RD-38): o 1º segmento do path é o company_id; a policy exige que ele esteja
-- entre as empresas do usuário (get_user_company_ids) — ninguém alcança comprovante de outra empresa.
-- Sem policy de DELETE: a exclusão é lógica (erp_pagar.anexo_path = NULL), o arquivo fica como trilha.

-- 1 · colunas de referência do anexo no título (NULL = sem comprovante). O arquivo em si fica no storage.
ALTER TABLE public.erp_pagar ADD COLUMN IF NOT EXISTS anexo_path text;
ALTER TABLE public.erp_pagar ADD COLUMN IF NOT EXISTS anexo_nome text;
COMMENT ON COLUMN public.erp_pagar.anexo_path IS 'Caminho no bucket privado pagar-comprovantes (<company_id>/<uuid>.<ext>). NULL = sem comprovante.';
COMMENT ON COLUMN public.erp_pagar.anexo_nome IS 'Nome original do arquivo do comprovante, só para exibição.';

-- 2 · bucket PRIVADO (public=false), limite 20 MB, só imagem/PDF. Idempotente.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pagar-comprovantes', 'pagar-comprovantes', false, 20971520,
  ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- 3 · policies por empresa (1º segmento do path = company_id). SELECT (abrir por link assinado) + INSERT
-- (enviar). Sem UPDATE/DELETE: não há upsert/move e a exclusão é lógica na tabela.
DROP POLICY IF EXISTS pagar_comprovantes_select ON storage.objects;
CREATE POLICY pagar_comprovantes_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'pagar-comprovantes' AND (
      is_admin() OR (storage.foldername(name))[1] IN (SELECT get_user_company_ids()::text)
    )
  );

DROP POLICY IF EXISTS pagar_comprovantes_insert ON storage.objects;
CREATE POLICY pagar_comprovantes_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'pagar-comprovantes' AND (
      is_admin() OR (storage.foldername(name))[1] IN (SELECT get_user_company_ids()::text)
    )
  );

-- 4 · textos do "?" (RD-95) dos campos novos (fonte do AjudaCampo / fn_ajuda_campo_listar).
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
(
  'financeiro.despesa.comprovante',
  '/dashboard/financeiro/nova-despesa',
  'Despesa',
  'Anexo (comprovante/nota)',
  'Opcional. Clique para escolher um arquivo (foto do comprovante, boleto ou nota fiscal). Aceita imagem (JPG, PNG, WEBP, HEIC) ou PDF, até 20 MB. Para trocar, clique em "Trocar"; para tirar, em "Remover".',
  'Guarda a prova do pagamento junto da despesa: na hora de conferir no banco, na prestação de contas ou numa auditoria, o comprovante está a um clique, sem procurar em e-mail ou no WhatsApp. O arquivo fica num cofre por empresa — só quem é da sua empresa consegue abrir.',
  'Você pagou um boleto pelo app do banco, salvou o print e anexa aqui. Depois, na lista de despesas, abre o comprovante quando o contador pedir.',
  'Anexar um arquivo gigante ou de outro tipo (ex.: vídeo). Se passar de 20 MB ou não for imagem/PDF, o envio é recusado — reduza a imagem ou gere um PDF.',
  'gestao_empresarial',
  55
),
(
  'financeiro.despesa.ver_comprovante',
  '/dashboard/financeiro/nova-despesa',
  'Despesa',
  'Ver comprovante',
  'Botão de ação — não se preenche nada. Clique para abrir, numa aba nova, o comprovante já anexado a esta despesa.',
  'Confere o comprovante sem sair do fluxo. O link é temporário (vale alguns minutos) e só funciona para quem é da empresa, para o arquivo não vazar.',
  'Antes de marcar a despesa como paga, clique em "Ver comprovante" para conferir se o valor e o beneficiário batem.',
  'Achar que o link pode ser compartilhado por fora. Ele expira e é pessoal — quem receber sem acesso à empresa não consegue abrir.',
  'gestao_empresarial',
  56
)
ON CONFLICT (chave) DO NOTHING;

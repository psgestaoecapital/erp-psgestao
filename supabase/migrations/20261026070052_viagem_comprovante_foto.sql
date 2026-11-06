-- Viagem · foto do comprovante (auditor 24/10, gap "Despesas da viagem … com foto do comprovante" · desenvolvedor_4_g,
-- faixa 52). Só aditivo: um bucket privado novo e as suas policies. A coluna erp_viagem_lancamento.anexo_path e a
-- gravação dela pela fn_viagem_lancamento_salvar já existem; nada existente muda.
--
--   Caminho do arquivo: <company_id>/<viagem_id>/<arquivo>. A 1ª pasta é a empresa: só quem é da empresa lê, e só
--   quem pode gravar viagem nela (fn_viagem_pode_gravar: perfil de consulta não) envia. Sem UPDATE/DELETE: comprovante
--   enviado não se troca nem se apaga pela tela (o lançamento novo leva a foto nova).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('viagens-comprovantes', 'viagens-comprovantes', false, 10485760,
        ARRAY['application/pdf','image/jpeg','image/png','image/webp','image/heic']::text[])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS viagens_comprovantes_sel ON storage.objects;
CREATE POLICY viagens_comprovantes_sel ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'viagens-comprovantes' AND (storage.foldername(name))[1] IN (SELECT public.get_user_company_ids()::text));
DROP POLICY IF EXISTS viagens_comprovantes_ins ON storage.objects;
CREATE POLICY viagens_comprovantes_ins ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'viagens-comprovantes'
    AND CASE WHEN (storage.foldername(name))[1] IN (SELECT public.get_user_company_ids()::text)
             THEN public.fn_viagem_pode_gravar(((storage.foldername(name))[1])::uuid) ELSE false END);

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/viagens', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.viagem.lanc_comprovante', 'Lançamento', 'Foto do comprovante', 'Tire a foto do cupom na hora, pelo celular, ou escolha a imagem/PDF da nota. Até 10 MB.', 'É a prova da despesa no acerto: o financeiro confere o valor e a data sem pedir o papel.', 'Foto do cupom do posto com valor e data legíveis', 'Foto tremida ou cortada sem o valor total: tire de novo antes de lançar.', 60),
  ('projetos.viagem.ver_comprovante', 'Lançamento', 'Ver comprovante', 'Abre a foto ou o PDF do cupom deste lançamento numa aba nova (o link vale 5 minutos).', 'Conferir o cupom ao revisar o acerto, sem sair da viagem.', 'Toque em "comprovante" ao lado do valor', 'Lançamento sem o ícone foi feito sem foto.', 61)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;

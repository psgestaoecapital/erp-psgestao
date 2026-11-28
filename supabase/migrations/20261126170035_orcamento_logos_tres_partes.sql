-- Hub · Orçamento/proposta: logos das 3 partes (prestadora · gestora da obra · tomadora/cliente). CEO 24/11.
-- Vale p/ qualquer ramo. RD-52: arquivo + PR, nunca apply_migration. Aditivo e nullable → não quebra orçamento existente.
-- RD-38 (lido no banco): prestadora = companies.logo_url (REUSADO, não duplicado). Tomadora = cliente_id/cliente_nome
-- (já existe) — falta só o logo dela por orçamento. Gestora da obra é NOVA (opcional). Upload reusa o bucket público
-- company-assets (mesmo padrão do logo da empresa em Configurações › Empresa), servido por URL pública como o pdf_url.
ALTER TABLE public.erp_orcamentos ADD COLUMN IF NOT EXISTS gestora_nome text;          -- gestora da obra (opcional)
ALTER TABLE public.erp_orcamentos ADD COLUMN IF NOT EXISTS gestora_logo_url text;       -- logo da gestora (upload ou cadastro)
ALTER TABLE public.erp_orcamentos ADD COLUMN IF NOT EXISTS gestora_cadastro_id uuid;    -- se a gestora veio de um cadastro existente
ALTER TABLE public.erp_orcamentos ADD COLUMN IF NOT EXISTS cliente_logo_url text;       -- logo da tomadora/cliente por orçamento

-- RD-95: ajuda dos campos novos no editor do orçamento (gestora + logos). Aditivo/idempotente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem) VALUES
 ('orcamentos.logos.gestora_nome', '/dashboard/orcamentos', 'Logomarcas', 'Gestora da obra',
  'Nome da administradora/contratante que gerencia a obra e contrata a prestadora (opcional). Deixe em branco se não houver.',
  'Identifica a 3ª parte do projeto na proposta, entre a sua empresa (prestadora) e o cliente (dono da obra).',
  'Construtora Alfa (gestão da obra)', 'Confundir com o cliente (dono da obra) — a gestora é a intermediária.', 'projetos', 10),
 ('orcamentos.logos.gestora_logo', '/dashboard/orcamentos', 'Logomarcas', 'Logo da gestora',
  'Envie o logo da gestora (PNG, JPG ou SVG, até 2 MB) ou deixe em branco.',
  'Aparece no cabeçalho da proposta (tela, PDF e link público) com o rótulo "Gestão da obra".',
  'logo_construtora.png', 'Subir foto pesada — use o logo (até 2 MB).', 'projetos', 11),
 ('orcamentos.logos.cliente_logo', '/dashboard/orcamentos', 'Logomarcas', 'Logo do cliente',
  'Envie o logo do cliente/dono da obra (PNG, JPG ou SVG, até 2 MB) ou deixe em branco.',
  'Aparece no cabeçalho da proposta com o rótulo "Cliente". A prestadora usa o logo da sua empresa (Configurações › Empresa).',
  'logo_cliente.png', 'Esquecer que a prestadora puxa o logo da própria empresa, não daqui.', 'projetos', 12)
ON CONFLICT (chave) DO NOTHING;

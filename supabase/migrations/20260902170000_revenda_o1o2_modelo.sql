-- Revenda de Veículos · Ondas 1 e 2 · modelo de dados.
-- Item SERIALIZADO (não é linha em erp_produtos): o chassi é a chave de tudo, cada carro é único
-- (custo próprio, dias parados próprios). Não recria financeiro: custo dispara erp_pagar via gancho
-- ref_externa (já existe). Multi-tenant company_id + RLS. Nada de venda/fiscal (Ondas 3-4).

CREATE TABLE IF NOT EXISTS public.veic_veiculo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  chassi text NOT NULL,
  placa text,                       -- placa muda e carro sem placa existe → NÃO obrigatória
  renavam text,
  marca text, modelo text, versao text,
  ano_fabricacao int, ano_modelo int,
  cor text, combustivel text, potencia_cv numeric, cilindradas numeric, portas int, cambio text,
  km_entrada numeric, km_atual numeric,
  situacao text NOT NULL DEFAULT 'em_preparacao'
    CHECK (situacao IN ('em_preparacao','disponivel','reservado','vendido','entregue','devolvido')),
  origem text CHECK (origem IN ('compra_pf','compra_pj','consignacao','troca')),
  data_entrada date NOT NULL DEFAULT CURRENT_DATE,
  fornecedor_id uuid REFERENCES public.erp_clientes(id) ON DELETE SET NULL,  -- quem vendeu p/ a loja
  fornecedor_nome text,
  valor_aquisicao numeric,
  foto_url text,
  observacao text,
  ativo boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
-- chassi único por empresa, ignorando os soft-deletados
CREATE UNIQUE INDEX IF NOT EXISTS ux_veic_veiculo_chassi ON public.veic_veiculo (company_id, chassi) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_veic_veiculo_company_situacao ON public.veic_veiculo (company_id, situacao) WHERE deleted_at IS NULL;

-- linha do tempo: entrada, cada custo, cada mudança de situação — sempre com autor (§2.2)
CREATE TABLE IF NOT EXISTS public.veic_veiculo_evento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  veiculo_id uuid NOT NULL REFERENCES public.veic_veiculo(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  descricao text,
  data_evento timestamptz NOT NULL DEFAULT now(),
  usuario_id uuid,
  payload jsonb
);
CREATE INDEX IF NOT EXISTS ix_veic_evento_veiculo ON public.veic_veiculo_evento (veiculo_id, data_evento);

-- custo amarrado ao chassi (§3.1). entra_base_fiscal 3 estados (NULL = aguarda contador, §3.2).
CREATE TABLE IF NOT EXISTS public.veic_custo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  veiculo_id uuid NOT NULL REFERENCES public.veic_veiculo(id) ON DELETE CASCADE,
  categoria text NOT NULL CHECK (categoria IN
    ('aquisicao','documentacao','despachante','preparacao','peca','mao_de_obra','debito_assumido','frete','comissao','outro')),
  descricao text,
  valor numeric NOT NULL CHECK (valor >= 0),
  fornecedor_id uuid REFERENCES public.erp_clientes(id) ON DELETE SET NULL,
  fornecedor_nome text,
  data_custo date NOT NULL DEFAULT CURRENT_DATE,
  entra_base_fiscal boolean,          -- NULL de propósito: aguarda definição do contador (item 2.5)
  pagar_id uuid REFERENCES public.erp_pagar(id) ON DELETE SET NULL,
  documento text,
  observacao text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX IF NOT EXISTS ix_veic_custo_veiculo ON public.veic_custo (veiculo_id) WHERE deleted_at IS NULL;

-- parâmetros da empresa: faixas do semáforo (configuráveis) + margem alvo (§2.4/§3.5/§6.5)
CREATE TABLE IF NOT EXISTS public.veic_config (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  semaforo_verde_ate_dias int NOT NULL DEFAULT 30,
  semaforo_amarelo_ate_dias int NOT NULL DEFAULT 60,
  margem_alvo_pct numeric NOT NULL DEFAULT 20,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS + grants + trigger updated_at
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['veic_veiculo','veic_veiculo_evento','veic_custo','veic_config'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_rw', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL
        USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
        WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin())$p$, t||'_rw', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
  -- updated_at só onde há a coluna
  FOREACH t IN ARRAY ARRAY['veic_veiculo','veic_config'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'tg_'||t||'_upd', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_update_updated_at()', 'tg_'||t||'_upd', t);
  END LOOP;
END $rls$;

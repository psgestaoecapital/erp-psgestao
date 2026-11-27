// Gate — Faturamento de serviço da oficina (centralizado): vínculo fiscal no item + NFS-e pré-preenchida/agrupada.
// Estático, sem rede. Garante que a mudança é ADITIVA (não quebra o fluxo antigo / tablet) e cobre inclusão + emissão.
import { readFileSync, readdirSync, existsSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// -------- migration --------
const dir = 'supabase/migrations'
const nome = readdirSync(dir).find((n) => n.endsWith('_oficina_nfse_servico_centralizado.sql'))
ok(!!nome, 'migration presente')
const mig = nome ? readFileSync(`${dir}/${nome}`, 'utf8') : ''
const semComent = mig.replace(/--.*$/gm, '')

ok(/ADD COLUMN IF NOT EXISTS servico_fiscal_id uuid/.test(mig), 'coluna nova servico_fiscal_id (aditiva)')
ok(/FOREIGN KEY \(servico_fiscal_id\) REFERENCES public\.erp_servicos\(id\)/.test(mig), 'FK servico_fiscal_id → erp_servicos')
ok(/CREATE INDEX IF NOT EXISTS[\s\S]*servico_fiscal_id/.test(mig), 'índice do vínculo fiscal')
ok(/CREATE OR REPLACE FUNCTION public\.fn_oficina_diagnostico_salvar\(/.test(mig)
   && /servico_fiscal_id = CASE WHEN v_has_fiscal THEN v_serv_fiscal ELSE servico_fiscal_id END/.test(mig), 'salvar persiste servico_fiscal_id (preserva quando a chave não vem)')
ok(/s\.company_id = p_company_id/.test(mig), 'vínculo fiscal validado na própria empresa')
ok(/CREATE OR REPLACE FUNCTION public\.fn_os_nfse_preparar\(/.test(mig)
   && /'grupos_fiscais'/.test(mig) && /'itens_sem_vinculo'/.test(mig) && /'tem_vinculo'/.test(mig), 'preparar: grupos_fiscais + itens_sem_vinculo + tem_vinculo (aditivos)')
// não regride o fluxo antigo: mantém os campos usados hoje pela tela
ok(/'servicos_fiscais', v_servicos/.test(mig) && /'valor_servicos', v_val_serv/.test(mig) && /'servico_fiscal_id_default', v_default/.test(mig), 'preparar mantém os campos atuais (servicos_fiscais/valor_servicos/default) — sem regressão')
// não toca a ligação de peça faturada nem o fluxo de peças
ok(!/fn_os_item_ligar_produto_faturada/.test(semComent), 'não toca fn_os_item_ligar_produto_faturada')
ok(!/INSERT INTO (public\.)?erp_receber|UPDATE (public\.)?erp_receber/.test(semComent), 'não escreve em erp_receber')
ok(/INSERT INTO public\.erp_ajuda_campo[\s\S]*oficina\.os\.servico_fiscal/.test(mig) && /'publicado'/.test(mig), 'ajuda RD-95 das chaves novas')

// -------- front: inclusão --------
const itensLib = readFileSync('src/lib/oficina/itensNaOS.ts', 'utf8')
ok(/servico_fiscal_id\?: string \| null/.test(itensLib) && /servico_fiscal_id: e \? \(e\.servico_fiscal_id/.test(itensLib), 'itensNaOS carrega servico_fiscal_id no round-trip')

const card = existsSync('src/components/comum/OrdemServicoCard.tsx') ? readFileSync('src/components/comum/OrdemServicoCard.tsx', 'utf8') : ''
ok(/import ServicoAutocomplete/.test(card) && /ligarServicoFiscalOS/.test(card), 'OrdemServicoCard: seletor de serviço fiscal (ServicoAutocomplete) no item')
ok(/AjudaCampo chave="oficina\.os\.servico_fiscal"/.test(card), 'OrdemServicoCard: "?" RD-95 do vínculo fiscal')

// -------- front: emissão --------
const btn = existsSync('src/components/comum/EmitirNFSeOSButton.tsx') ? readFileSync('src/components/comum/EmitirNFSeOSButton.tsx', 'utf8') : ''
ok(/grupos_fiscais/.test(btn) && /tem_vinculo/.test(btn), 'EmitirNFSeOSButton consome grupos_fiscais/tem_vinculo')
ok(/comDiscriminacao/.test(btn), 'EmitirNFSeOSButton leva a discriminação dos itens nas observações')
ok(/Serão emitidas/.test(btn) && /fila/.test(btn), 'EmitirNFSeOSButton: preview "N notas" + emite uma por grupo (fila)')
ok(/itens_sem_vinculo/.test(btn), 'EmitirNFSeOSButton trata itens sem vínculo (seletor só p/ eles)')

if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
console.log('check-oficina-nfse-servico-centralizado OK')

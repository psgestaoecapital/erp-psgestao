// Gate (#5722): devolução de compra NF-e com transportador/veículo/volumes (grupo de transporte),
// aditivo/opt-in (sem preencher = como hoje), emissor único. Nomes oficiais da Focus. Estático, sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const types = readFileSync('src/lib/fiscal/types.ts', 'utf8')
ok(/transporte\?:\s*\{/.test(types) && types.includes('transportador?') && types.includes('veiculo?') && types.includes('volumes?'), 'types: NFeRequest.transporte (transportador/veículo/volumes)')

const b = readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8')
ok(b.includes("transporte?: NFeRequest['transporte']"), 'builder: manual.transporte aceito')
ok(b.includes('transporte: input.manual.transporte'), 'builder: repassa o transporte ao emissor único (sem emissor paralelo)')

const f = readFileSync('src/lib/fiscal/providers/focusnfe.ts', 'utf8')
for (const campo of ['cnpj_transportador', 'cpf_transportador', 'nome_transportador', 'inscricao_estadual_transportador', 'endereco_transportador', 'municipio_transportador', 'uf_transportador', 'veiculo_placa', 'veiculo_uf', 'veiculo_rntc']) {
  ok(f.includes(campo), `focus: campo ${campo} (nome oficial)`)
}
ok(f.includes('out.volumes = vols') || f.includes('volumes'), 'focus: volumes')
ok(f.replace(/\s+/g, ' ').includes('const t = req.transporte if (!t) return {}'), 'focus: só emite quando há transporte (sem regressão)')

const dd = readFileSync('src/lib/fiscal/danfeDados.ts', 'utf8')
ok(dd.includes('req.transporte') && dd.includes('nome_transportador'), 'danfe: mostra transportador (espelho por req; pós-emissão por payload_enviado)')

const r = readFileSync('src/app/api/fiscal/nfe/devolucao/route.ts', 'utf8')
ok(/transporte\?:/.test(r), 'rota: body aceita transporte')
ok(r.includes('CNPJ OU CPF do transportador, nunca os dois'), 'rota: valida CNPJ XOR CPF')
ok(r.includes('Placa do veículo deve ter 7 caracteres'), 'rota: valida placa (7 sem hífen)')
ok(r.includes('nome/razão social do transportador'), 'rota: exige nome quando há transportador')
ok(r.includes('transporte: transporteBuilder'), 'rota: passa o transporte ao builder')

const c = readFileSync('src/app/dashboard/fiscal/nfe/devolucao/DevolucaoCompraClient.tsx', 'utf8')
ok(c.includes('transportadora, peso_bruto, volumes_qtd'), 'tela: pré-preenche da nota de compra (transportadora/peso/volumes)')
ok(c.includes('chave="fiscal.nfe.devolucao.transp_doc"') && c.includes('chave="fiscal.nfe.devolucao.veic_placa"'), 'RD-95: "?" nos campos novos')
ok(c.replace(/\s+/g, ' ').includes('return Object.keys(t).length ? { transporte: t } : {}'), 'tela: transporte só quando preenchido (sem regressão)')

const dir = 'supabase/migrations'
const arq = readdirSync(dir).filter((x) => x.endsWith('_nfe_devolucao_ajuda_transporte_5722.sql')).sort().pop()
if (!arq) { console.error('✗ migration *_nfe_devolucao_ajuda_transporte_5722.sql não encontrada'); process.exit(1) }
const m = readFileSync(`${dir}/${arq}`, 'utf8')
ok(m.includes('INSERT INTO public.erp_ajuda_campo') && /WHERE NOT EXISTS/.test(m), 'migration: ajuda idempotente')
ok(m.includes("'fiscal.nfe.devolucao.transp_doc'") && m.includes("'fiscal.nfe.devolucao.veic_placa'"), 'migration: chaves dos campos novos')

if (falhas) process.exit(1)
console.log('check-nfe-devolucao-transporte-5722 OK')

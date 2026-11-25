// Gate (#9929): NF-e avulsa com impostos IPI/PIS/COFINS POR ITEM (regime normal), aditivo/opt-in.
// Builder aplica o override só quando informado; rota remessa mapeia; tela tem os campos com "?" (RD-95);
// ajuda cadastrada por migration. Estático, sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// builder
const b = readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8')
ok(/ipiOverride\?:/.test(b) && /pisOverride\?:/.test(b) && /cofinsOverride\?:/.test(b), 'builder: NFeBuilderItemInput aceita ipi/pis/cofins override')
ok(b.includes('ipi: it.ipiOverride'), 'builder: IPI só quando informado (senão undefined — sem regressão)')
ok(b.includes('pis: it.pisOverride'), 'builder: PIS override por item (senão cadastro)')
ok(b.includes('cofins: it.cofinsOverride'), 'builder: COFINS override por item (senão cadastro)')

// rota remessa
const r = readFileSync('src/app/api/fiscal/nfe/remessa/route.ts', 'utf8')
ok(/ipiCst\?:/.test(r) && /pisCst\?:/.test(r) && /cofinsCst\?:/.test(r), 'rota: aceita ipi/pis/cofins por item')
ok(r.includes('ipiOverride') && r.includes('pisOverride') && r.includes('cofinsOverride'), 'rota: monta os overrides e passa ao builder')
ok(r.replace(/\s+/g, ' ').includes('...(ipiOverride ? { ipiOverride } : {})'), 'rota: override só quando preenchido (sem regressão)')

// tela
const t = readFileSync('src/app/dashboard/fiscal/nfe/remessa/RemessaClient.tsx', 'utf8')
ok(/ipiCst\?:/.test(t) && /pisCst\?:/.test(t) && /cofinsCst\?:/.test(t), 'tela: ItemRem tem IPI/PIS/COFINS')
ok(t.includes('!simples') && t.includes('IPI, PIS e COFINS'), 'tela: bloco só no regime normal (!simples)')
ok(t.includes('chave={`fiscal.nfe_avulsa.item_${row.key}_cst`}') || t.includes('fiscal.nfe_avulsa.item_ipi_cst'), 'RD-95: "?" nos campos novos')
ok(t.includes('ipiCst') && t.includes('pisCst') && t.includes('cofinsCst') && t.includes('itens: itens.map'), 'tela: payload inclui os impostos novos')

// migration da ajuda (por sufixo)
const dir = 'supabase/migrations'
const arq = readdirSync(dir).filter((f) => f.endsWith('_nfe_avulsa_ajuda_ipi_pis_cofins_9929.sql')).sort().pop()
if (!arq) { console.error('✗ migration *_nfe_avulsa_ajuda_ipi_pis_cofins_9929.sql não encontrada'); process.exit(1) }
const m = readFileSync(`${dir}/${arq}`, 'utf8')
ok(m.includes("INSERT INTO public.erp_ajuda_campo"), 'migration: insere as chaves de ajuda')
for (const g of ['ipi', 'pis', 'cofins']) for (const c of ['cst', 'aliquota', 'valor']) {
  ok(m.includes(`fiscal.nfe_avulsa.item_${g}_${c}`), `ajuda: chave item_${g}_${c}`)
}
ok(/WHERE NOT EXISTS \(SELECT 1 FROM public\.erp_ajuda_campo/.test(m), 'ajuda: idempotente (NOT EXISTS)')

if (falhas) process.exit(1)
console.log('check-nfe-avulsa-impostos-item-9929 OK')

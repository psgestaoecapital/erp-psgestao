// Gate · Contrato de preços (gap 6): vínculo do serviço do contrato com o catálogo, CPU e margem.
// Sem rede: lê a tela e a migration.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const vin = readFileSync('src/app/dashboard/projetos/tabelas-preco/_componentes/VinculoCatalogo.tsx', 'utf8')
const pag = readFileSync('src/app/dashboard/projetos/tabelas-preco/page.tsx', 'utf8')
const mig = readFileSync('supabase/migrations/20261025180054_hb2_contrato_vinculo_catalogo.sql', 'utf8')
ok(/<VinculoCatalogo /.test(pag) && /cpuCatalogo/.test(pag) && /fn_tabela_preco_vinculos'/.test(vin) && /fn_tabela_preco_vinculo_gravar/.test(vin), 'tela: vínculo ligado à calculadora (CPU do catálogo) e gravando por RPC')
ok(/podeGravar \? \(/.test(vin), 'tela: escolher vínculo só para quem pode gravar')
ok(/AjudaCampo chave="hub\.tabela_preco\.vinculo"/.test(vin) && /AjudaCampo chave="hub\.tabela_preco\.vinculo_catalogo"/.test(vin) && /'hub\.tabela_preco\.vinculo'/.test(mig) && /'hub\.tabela_preco\.vinculo_catalogo'/.test(mig), 'RD-95: "?" com chave no banco')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON FUNCTION public\.fn_tabela_preco_vinculos\(uuid\) FROM PUBLIC, anon/.test(mig) && /fn__guarda_empresa/.test(mig) && /BEFORE INSERT OR UPDATE OR DELETE ON public\.erp_tabela_preco_vinculo/.test(mig), 'banco: RLS, REVOKE anon, guarda de empresa e trava de consulta')
ok(!/CREATE OR REPLACE VIEW/.test(mig) && !/DROP (TABLE|FUNCTION)/.test(mig), 'banco: aditiva (nada existente reescrito)')
if (falhas) process.exit(1)

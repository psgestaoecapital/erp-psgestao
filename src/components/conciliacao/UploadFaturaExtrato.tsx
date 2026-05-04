// src/components/conciliacao/UploadFaturaExtrato.tsx
// Modal de upload OFX foundational para Conciliacao.
// Fluxo: parse local (regex) -> hash SHA-256 -> upload Storage ->
//        RPC fn_conciliacao_criar_lote (backend ja aplicado).
// Identidade visual PS: espresso #3D2314, off-white #FAF7F2, dourado #C8941A.

'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/authFetch';
import { parseOFX, calcularHashSHA256 } from '@/lib/ofx-parser';

export interface EmpresaOption {
  id: string;
  nome: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (loteId: string) => void;
  empresas: EmpresaOption[];
}

type TipoLote = 'extrato_bancario' | 'fatura_cartao' | 'cartao_despesa';

const TIPOS: { value: TipoLote; label: string }[] = [
  { value: 'extrato_bancario', label: '🏦 Extrato Bancário' },
  { value: 'fatura_cartao', label: '💳 Fatura Cartão de Crédito' },
  { value: 'cartao_despesa', label: '💳 Cartão Despesa (débito)' },
];

export default function UploadFaturaExtrato({ isOpen, onClose, onSuccess, empresas }: Props) {
  const [companyId, setCompanyId] = useState<string>('');
  const [tipo, setTipo] = useState<TipoLote>('extrato_bancario');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [operadora, setOperadora] = useState<string>('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function reset() {
    setCompanyId('');
    setTipo('extrato_bancario');
    setArquivo(null);
    setOperadora('');
    setErro(null);
    setAviso(null);
    setCarregando(false);
  }

  function fechar() {
    if (carregando) return;
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (!arquivo) {
      setErro('Selecione um arquivo OFX.');
      return;
    }
    if (!companyId) {
      setErro('Selecione a empresa.');
      return;
    }

    setCarregando(true);
    setErro(null);
    setAviso(null);

    try {
      // 1. Ler texto + parsear (cliente)
      const texto = await arquivo.text();
      const resultado = parseOFX(texto);

      if (resultado.erro) {
        setErro(resultado.erro);
        setCarregando(false);
        return;
      }
      if (resultado.movimentos.length === 0) {
        setErro('Nenhum movimento valido encontrado no arquivo.');
        setCarregando(false);
        return;
      }
      if (resultado.aviso) {
        setAviso(resultado.aviso);
      }

      // 2. Hash SHA-256
      const hash = await calcularHashSHA256(arquivo);

      // 3. Upload do arquivo no bucket
      const supabase = supabaseBrowser();
      const path = `${companyId}/${Date.now()}-${arquivo.name}`;
      const { error: uploadErr } = await supabase.storage
        .from('conciliacao-arquivos')
        .upload(path, arquivo, { contentType: arquivo.type || 'application/octet-stream' });

      if (uploadErr) {
        // Se for duplicate path, retry com nome diferente
        throw new Error('Falha ao enviar arquivo: ' + uploadErr.message);
      }

      // 4. RPC backend cria lote + movimentos + dispara natureza automatica
      const { data, error: rpcErr } = await supabase.rpc('fn_conciliacao_criar_lote', {
        p_company_id: companyId,
        p_tipo: tipo,
        p_origem: 'upload_ofx',
        p_nome: arquivo.name,
        p_arquivo_nome: arquivo.name,
        p_arquivo_hash: hash,
        p_storage_path: path,
        p_movimentos: resultado.movimentos,
        p_operadora: operadora.trim() || null,
      });

      if (rpcErr) {
        throw new Error(rpcErr.message);
      }

      // RPC retorna { sucesso, lote_id, total_movimentos, mensagem, erro?, lote_existente_id? }
      const r: any = data || {};
      if (!r.sucesso) {
        if (r.erro === 'arquivo_duplicado') {
          setErro(
            `Esse arquivo ja foi importado antes. Lote existente: ${r.lote_existente_id || 'desconhecido'}.`
          );
        } else {
          setErro(r.mensagem || r.erro || 'Erro ao criar lote.');
        }
        setCarregando(false);
        return;
      }

      // Sucesso — fecha modal + notifica pai
      onSuccess(r.lote_id);
      reset();
    } catch (e: any) {
      console.error('[UploadFaturaExtrato] erro:', e);
      setErro(e?.message || 'Erro inesperado ao importar arquivo.');
    } finally {
      setCarregando(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      onClick={fechar}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(61,35,20,0.55)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#FAF7F2',
          borderRadius: 12,
          maxWidth: 520,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 12px 36px rgba(61,35,20,0.25)',
          padding: 28,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 1.2, color: '#C8941A', fontWeight: 700, textTransform: 'uppercase' }}>
              Conciliação
            </div>
            <h2 style={{ margin: '4px 0 0 0', fontSize: 20, fontWeight: 700, color: '#3D2314' }}>
              Importar Fatura/Extrato
            </h2>
          </div>
          <button
            onClick={fechar}
            disabled={carregando}
            aria-label="Fechar"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 22,
              color: '#5D4534',
              cursor: carregando ? 'not-allowed' : 'pointer',
              padding: 0,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Empresa */}
          <div>
            <label style={labelStyle}>Empresa *</label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              disabled={carregando}
              style={selectStyle}
            >
              <option value="">Selecione uma empresa</option>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
          </div>

          {/* Tipo */}
          <div>
            <label style={labelStyle}>Tipo *</label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoLote)}
              disabled={carregando}
              style={selectStyle}
            >
              {TIPOS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Operadora */}
          <div>
            <label style={labelStyle}>Operadora (opcional)</label>
            <input
              type="text"
              value={operadora}
              onChange={(e) => setOperadora(e.target.value)}
              disabled={carregando}
              placeholder="Visa, Mastercard, Sicredi, Itaú..."
              style={inputStyle}
            />
          </div>

          {/* Arquivo */}
          <div>
            <label style={labelStyle}>Arquivo (.ofx) *</label>
            <input
              type="file"
              accept=".ofx,.OFX"
              onChange={(e) => setArquivo(e.target.files?.[0] || null)}
              disabled={carregando}
              style={inputStyle}
            />
            {arquivo && (
              <div style={{ fontSize: 11, color: '#5D4534', marginTop: 4 }}>
                {arquivo.name} · {Math.round(arquivo.size / 1024)} KB
              </div>
            )}
          </div>

          {/* Aviso (parser flag) */}
          {aviso && (
            <div
              style={{
                padding: '10px 12px',
                background: '#FFF8EC',
                border: '1px solid #F0DCB0',
                borderRadius: 8,
                color: '#A87810',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              ⚠️ {aviso}
            </div>
          )}

          {/* Erro */}
          {erro && (
            <div
              style={{
                padding: '10px 12px',
                background: '#FBE9E7',
                border: '1px solid #F5C0BC',
                borderRadius: 8,
                color: '#B1342B',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {erro}
            </div>
          )}

          {/* Botoes */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              onClick={fechar}
              disabled={carregando}
              style={{
                padding: '10px 18px',
                background: 'transparent',
                color: '#3D2314',
                border: '1px solid #d6cfc4',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                cursor: carregando ? 'not-allowed' : 'pointer',
              }}
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={carregando || !arquivo || !companyId}
              style={{
                padding: '10px 22px',
                background: carregando || !arquivo || !companyId ? '#d6cfc4' : '#C8941A',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: carregando || !arquivo || !companyId ? 'not-allowed' : 'pointer',
                transition: 'background 150ms ease',
              }}
            >
              {carregando ? 'Importando…' : 'Importar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#3D2314',
  marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  background: '#FFFFFF',
  border: '1px solid #d6cfc4',
  borderRadius: 6,
  fontSize: 13,
  color: '#3D2314',
  outline: 'none',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutGrid,
  Boxes,
  Sparkles,
  Shield,
  Map,
  Menu,
  X,
} from 'lucide-react';
import { COR } from './colors';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  placeholder?: boolean;
};

const NAV: NavItem[] = [
  { href: '/admin/planos', label: 'Planos', icon: LayoutGrid },
  { href: '/admin/modulos', label: 'Modulos', icon: Boxes, placeholder: true },
  { href: '/admin/features', label: 'Features', icon: Sparkles, placeholder: true },
  { href: '/admin/truth-auditor', label: 'Truth Auditor', icon: Shield, placeholder: true },
  { href: '/admin/roadmap', label: 'Roadmap', icon: Map, placeholder: true },
];

export default function Sidebar({ userEmail }: { userEmail?: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const navList = (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '16px 12px' }}>
      {NAV.map((item) => {
        const Icon = item.icon;
        const active = pathname?.startsWith(item.href) ?? false;
        const content = (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 12px',
              borderRadius: 8,
              color: active ? COR.gold : COR.offWhite,
              background: active ? 'rgba(200,148,26,0.12)' : 'transparent',
              fontSize: 14,
              fontWeight: active ? 600 : 500,
              transition: 'background 0.15s, color 0.15s',
              opacity: item.placeholder ? 0.55 : 1,
            }}
          >
            <Icon size={18} />
            <span>{item.label}</span>
            {item.placeholder && (
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  color: COR.espressoL,
                }}
              >
                em breve
              </span>
            )}
          </span>
        );

        if (item.placeholder) {
          return (
            <div key={item.href} style={{ cursor: 'not-allowed' }}>
              {content}
            </div>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            style={{ textDecoration: 'none' }}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );

  const sidebar = (
    <aside
      style={{
        background: COR.espresso,
        color: COR.offWhite,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
      }}
    >
      <div
        style={{
          padding: '20px 16px 16px',
          borderBottom: '1px solid rgba(250,247,242,0.1)',
        }}
      >
        <Link href="/admin/planos" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: COR.gold }}>
              PS Gestao
            </span>
            <span style={{ fontSize: 11, color: COR.espressoL, letterSpacing: 0.5 }}>
              ADMIN
            </span>
          </div>
        </Link>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>{navList}</div>
      {userEmail && (
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid rgba(250,247,242,0.1)',
            fontSize: 11,
            color: COR.espressoL,
            wordBreak: 'break-all',
          }}
        >
          {userEmail}
        </div>
      )}
    </aside>
  );

  return (
    <>
      {/* Mobile toggle button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menu"
        className="md:hidden"
        style={{
          position: 'fixed',
          top: 12,
          left: 12,
          zIndex: 40,
          background: COR.espresso,
          color: COR.offWhite,
          border: 'none',
          borderRadius: 8,
          padding: 10,
          boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
        }}
      >
        <Menu size={20} />
      </button>

      {/* Desktop sidebar */}
      <div
        className="hidden md:block"
        style={{ width: 240, flexShrink: 0, position: 'sticky', top: 0 }}
      >
        {sidebar}
      </div>

      {/* Mobile drawer */}
      {open && (
        <div
          className="md:hidden"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
          }}
        >
          <div style={{ width: 260, position: 'relative' }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar menu"
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                background: 'transparent',
                color: COR.offWhite,
                border: 'none',
                padding: 6,
                zIndex: 1,
              }}
            >
              <X size={20} />
            </button>
            {sidebar}
          </div>
          <div
            onClick={() => setOpen(false)}
            style={{ flex: 1, background: 'rgba(0,0,0,0.4)' }}
          />
        </div>
      )}
    </>
  );
}

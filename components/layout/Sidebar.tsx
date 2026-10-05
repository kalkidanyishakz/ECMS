'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  IconAlertTriangle,
  IconBox,
  IconBuilding,
  IconChevronDown,
  IconCurrencyDollar,
  IconFiles,
  IconFileText,
  IconFingerprint,
  IconLayoutDashboard,
  IconLicense,
  IconListCheck,
  IconMenu2,
  IconPackages,
  IconReport,
  IconSettings,
  IconUsers,
  IconX,
} from '@tabler/icons-react';
import { Logo } from '@/components/ui/Logo';
import { cn } from '@/lib/utils';
import { navigationModules } from '@/lib/navigation';

const moduleIcons = [
  IconLayoutDashboard,
  IconBuilding,
  IconLicense,
  IconCurrencyDollar,
  IconFingerprint,
  IconListCheck,
  IconBox,
  IconPackages,
  IconUsers,
  IconFiles,
  IconAlertTriangle,
  IconReport,
  IconFileText,
  IconSettings,
];

function isModuleActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [manualHref, setManualHref] = useState<string | null | undefined>(undefined);

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-3" aria-label="Modules">
      {navigationModules.map((module, index) => {
        const Icon = moduleIcons[index];
        const active = isModuleActive(pathname, module.href);
        const subItems = module.sections.flatMap((section) => section.items);
        const hasSub = subItems.length > 1 || (subItems.length === 1 && subItems[0].href !== module.href);
        const expanded = hasSub && (manualHref === undefined ? active : manualHref === module.href);
        return (
          <div key={module.href} className="flex flex-col">
            <div className={cn('group flex items-center rounded-lg transition-colors', active ? 'bg-ecms-elevated' : 'hover:bg-ecms-elevated')}>
              <Link
                href={module.href}
                onClick={onNavigate}
                className={cn('flex flex-1 items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors', active ? 'text-ecms-amber' : 'text-ecms-muted group-hover:text-ecms-text')}
              >
                <Icon size={18} stroke={1.7} className={cn('shrink-0 transition-colors', active ? 'text-ecms-amber' : 'text-ecms-muted group-hover:text-ecms-text')} />
                <span className="truncate">{module.label}</span>
              </Link>
              {hasSub && (
                <button
                  type="button"
                  aria-label={`Toggle ${module.label} sub-menu`}
                  aria-expanded={expanded}
                  onClick={() => setManualHref(expanded ? null : module.href)}
                  className="mr-1 rounded-md p-1.5 text-ecms-muted hover:text-ecms-text"
                >
                  <IconChevronDown size={15} className={cn('transition-transform', expanded ? 'rotate-180' : '')} />
                </button>
              )}
            </div>
            {expanded && (
              <div className="mb-1 ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-ecms-border pl-2">
                {subItems.map((item) => {
                  const itemPath = item.href.split('?')[0];
                  const itemActive = !item.href.includes('?') && pathname === itemPath;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                onClick={() => {
                  setManualHref(undefined);
                  onNavigate?.();
                }}
                      className={cn('rounded-md px-3 py-1.5 text-xs transition-colors', itemActive ? 'text-ecms-amber' : 'text-ecms-muted hover:bg-ecms-elevated hover:text-ecms-text')}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-ecms-border bg-ecms-navy md:flex">
        <Link href="/dashboard" className="flex h-14 items-center gap-2.5 border-b border-ecms-border px-4" title="ECMS home">
          <Logo variant="mark" />
          <span className="text-sm font-bold text-ecms-text">ECMS</span>
        </Link>
        <SidebarNav />
      </aside>
      <button type="button" onClick={() => setMobileOpen(true)} className="fixed left-3 top-3 z-50 rounded-md border border-ecms-border bg-ecms-navy p-2 text-ecms-text md:hidden" aria-label="Open navigation"><IconMenu2 size={20} /></button>
      {mobileOpen && <div className="fixed inset-0 z-50 bg-black/60 md:hidden" onClick={() => setMobileOpen(false)}><aside className="flex h-full w-72 max-w-[94vw] flex-col bg-ecms-navy" onClick={(event) => event.stopPropagation()}><div className="flex h-14 items-center justify-between border-b border-ecms-border px-4"><Link href="/dashboard" onClick={() => setMobileOpen(false)} className="flex items-center gap-2.5"><Logo variant="mark" /><span className="text-sm font-bold text-ecms-text">ECMS</span></Link><button type="button" onClick={() => setMobileOpen(false)} className="rounded-md bg-ecms-elevated p-2 text-ecms-text" aria-label="Close navigation"><IconX size={18} /></button></div><SidebarNav onNavigate={() => setMobileOpen(false)} /></aside></div>}
    </>
  );
}

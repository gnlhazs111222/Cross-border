import { useI18n } from '../i18n/I18nContext';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowRight, Check, LoaderCircle, Package, X } from 'lucide-react';
import type { Platform, Product } from '../types';

export function Button({ children, variant = 'primary', busy, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; busy?: boolean }) {
  return <button {...props} className={`button ${variant} ${className}`} disabled={props.disabled || busy}>{busy && <LoaderCircle className="spin" size={16} aria-hidden="true" />}{children}</button>;
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'green' | 'amber' | 'red' | 'neutral' | 'blue' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  const { t } = useI18n();
  return <div className="page-heading"><div><div className="eyebrow">{t(eyebrow)}</div><h1>{t(title)}</h1><p>{t(description)}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  const { t } = useI18n();
  return <div className="empty-state"><div className="empty-icon"><Package size={28} /></div><h2>{t(title)}</h2><p>{t(description)}</p>{action}</div>;
}
export function NextButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Button {...props}>{children}<ArrowRight size={16} aria-hidden="true" /></Button>;
}
export function Notice({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' }) {
  return <div className={`notice ${tone}`}>{children}</div>;
}
export function Modal({ open, onOpenChange, title, description, children, wide = false }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="modal-overlay" /><Dialog.Content className={`modal ${wide ? 'wide' : ''}`}><div className="modal-heading"><div><Dialog.Title>{t(title)}</Dialog.Title><Dialog.Description>{t(description)}</Dialog.Description></div><Dialog.Close asChild><Button variant="ghost" aria-label={t("Close dialog")}><X size={20} /></Button></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function PlatformTabs({ value, onChange, disabled }: { value: Platform; onChange: (p: Platform) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return <Tabs.Root value={value} onValueChange={v => onChange(v as Platform)}><Tabs.List className="platform-tabs" aria-label={t("Listing platform")}><Tabs.Trigger value="amazon" disabled={disabled}>{t("Amazon US")}</Tabs.Trigger><Tabs.Trigger value="shopify" disabled={disabled}>{t("Shopify US")}</Tabs.Trigger></Tabs.List></Tabs.Root>;
}
export function ProductVisual({ product, large = false }: { product: Product; large?: boolean }) {
  const color = product.color === 'Ivory' ? '#ddd8ce' : product.color === 'Sage' ? '#8b9c89' : '#303737';
  return <div className={`product-visual ${large ? 'large' : ''}`} aria-hidden="true">
    {product.visual === 'bottle' ? <svg viewBox="0 0 100 140" fill="none"><ellipse cx="50" cy="126" rx="26" ry="5" fill="#d7dfd9" /><rect x="35" y="13" width="30" height="19" rx="5" fill={color} /><path d="M35 28h30v9c0 5 10 9 10 21v56c0 9-5 13-13 13H38c-8 0-13-4-13-13V58c0-12 10-16 10-21v-9Z" fill={color} /><path d="M34 57v53c0 5 1 7 4 8" stroke="white" strokeOpacity=".15" strokeWidth="3" strokeLinecap="round" /><path d="M37 23h26M36 29h28" stroke="white" strokeOpacity=".14" /><path d="m46 91 4-7 4 7h-8Z" stroke={product.color === 'Black' ? '#a9b6ad' : '#6d776e'} strokeWidth="1.2" />{product.straw && <path d="M51 14V3h12" stroke="#58635b" strokeWidth="4" strokeLinecap="round" />}</svg>
    : product.visual === 'bag' ? <svg viewBox="0 0 100 140"><path d="M23 49h54l7 73H16l7-73Z" fill="#4c5551" /><path d="M35 56V35a15 15 0 0 1 30 0v21" fill="none" stroke="#859087" strokeWidth="5" /></svg>
    : <svg viewBox="0 0 100 140"><path d="M48 62v52M24 120h52" stroke="#45554d" strokeWidth="7" strokeLinecap="round" /><path d="M31 26h36l15 43H16l15-43Z" fill="#607468" /></svg>}
  </div>;
}
export function CheckLine({ children }: { children: ReactNode }) { return <div className="check-line"><Check size={15} aria-hidden="true" /><span>{children}</span></div>; }

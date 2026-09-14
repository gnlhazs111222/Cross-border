import { useEffect, useState } from 'react';
import { BookOpen, Store } from 'lucide-react';
import { SERVER_MODE } from '../services/apiClient';
import { mockApi } from '../services/mockApi';
import { useI18n } from '../i18n/I18nContext';
import { Badge, ProductVisual } from './ui';
import type { ProductAsset } from '../../shared/contracts';
import type { Listing, Platform } from '../types';

/**
 * The listing the way the marketplace shows it: the vetted picture first, the generated copy underneath.
 *
 * The review stage reads a product page, it does not write one — every control that changes copy lives in
 * the Listing Studio, and every fact behind a line stays one click away in the sources list.
 */
export function PlatformListingView({ listing, sku }: { listing: Listing; sku?: string | null }) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<ProductAsset[]>(() => sku ? mockApi.assetsFor(sku) : []);
  useEffect(() => {
    let live = true;
    if (!sku || !SERVER_MODE) return;
    void mockApi.listAssets(sku).then(next => { if (live) setAssets(next); }).catch(() => undefined);
    return () => { live = false; };
  }, [sku]);
  const product = mockApi.getState().catalog.find(item => item.sku === sku);
  const pictures = assets.filter(asset => asset.kind === 'image');
  // The picture the check ran on is the one a person vetted, and the main image is the page's hero.
  const hero = pictures.find(asset => asset.role === 'main') ?? pictures[0];
  const price = mockApi.getState().pricing?.suggestedPrice ?? null;
  const amazon = (listing.platform as Platform) !== 'shopify';
  const platform = t(amazon ? 'Amazon US' : 'Shopify US');
  return <section className="panel product-page" data-testid="platform-listing-view">
    <div className="panel-title"><Store size={19} /><h3>{t('{platform} product page', { platform })}</h3><Badge>{t('Read-only preview')}</Badge></div>
    <div className="product-page-body">
      <div className="product-page-media">
        {hero ? <img src={mockApi.assetContentUrl(hero.recordId)} alt={hero.fileName} /> : product && <ProductVisual product={product} />}
        <p className="footnote">{hero ? t('Vetted picture: {name}', { name: hero.fileName }) : t('No picture is on file for this SKU yet.')}</p>
      </div>
      <div className="product-page-copy" lang="en">
        <h2>{listing.title}</h2>
        {!amazon && price !== null && <p className="product-page-price">USD {price.toFixed(2)}</p>}
        {amazon
          ? <><ul className="listing-bullets">{listing.bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}</ul>
            <p className="product-page-description">{listing.description}</p>
            <dl className="attribute-grid">{Object.entries(listing.attributes).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></>
          : <><p className="product-page-description">{listing.description}</p>
            <ul className="listing-bullets">{listing.bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}</ul></>}
      </div>
    </div>
    <details className="fact-sources"><summary><BookOpen size={16} /> {t('Fact Sources')} <Badge>{t('{count} confirmed fields', { count: listing.sources.length })}</Badge></summary>
      <div className="source-facts">{listing.sources.map(fact => <div key={fact.key}><strong>{t(fact.label)}</strong><span>{t('Source:')} {t(fact.source)}</span><small>{t(fact.anchor)}</small></div>)}</div>
    </details>
  </section>;
}

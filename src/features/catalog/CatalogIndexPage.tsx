/*
 * Catalog index (/catalog): the dense part list across every component kind, optionally filtered to
 * one layer with ?layer=T1. Structure and behaviour live in PartList; this route only resolves the
 * layer parameter.
 */
import '../../styles/dense.css';
import { useSearchParams } from 'react-router';
import type { Tier } from '../../contracts';
import { TIERS } from '../../contracts';
import { CatalogList } from './PartList';

const readLayer = (value: string | null): Tier | undefined =>
  value && (TIERS as readonly string[]).includes(value) ? (value as Tier) : undefined;

export default function CatalogIndexPage() {
  const [params] = useSearchParams();
  const layer = readLayer(params.get('layer'));
  return (
    <div className="app-page parts-page">
      <div className="container">
        <CatalogList key={layer ?? 'all'} layer={layer} />
      </div>
    </div>
  );
}

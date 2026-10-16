/*
 * SYNTHETIC DEMONSTRATION PRICEBOOK. Every amount is invented for the preview and is NOT a real
 * vendor price or quote. Rates are `price_type: "estimate"` with `verification_status: "unverified"`.
 * One rate is deliberately expired to exercise stale-price handling.
 */
import type { Pricebook } from '../../contracts';
import { DEFAULT_PRICEBOOK_ID } from '../../domain/build';
import { DEMO_CAPTURED_AT, DEMO_VERSION, demoItemId } from './catalog';

type Rate = Pricebook['rates'][number];

const NOTE =
  'SYNTHETIC DEMO PRICE — invented for the PickYour.AI preview; not a real price or quote.';

function rate(
  slug: string,
  catalogItemId: string,
  meter: Rate['meter'],
  amount: string,
  extra: Partial<Rate> = {},
): Rate {
  return {
    id: `rate.demo.${slug}`,
    catalog_item_id: catalogItemId,
    catalog_item_version: DEMO_VERSION,
    meter,
    unit_price: { amount, currency: 'USD' },
    valid_from: '2026-10-01T00:00:00Z',
    provenance: { checked_at: DEMO_CAPTURED_AT, verification_status: 'unverified', notes: NOTE },
    price_type: 'estimate',
    ...extra,
  };
}

export const DEMO_PRICEBOOK: Pricebook = {
  schema_version: '1.0.0',
  id: DEFAULT_PRICEBOOK_ID,
  revision: 1,
  captured_at: DEMO_CAPTURED_AT,
  rates: [
    rate('aurora-large.in', demoItemId('model', 'aurora-large'), 'input_tokens_1m', '3.00'),
    rate('aurora-large.out', demoItemId('model', 'aurora-large'), 'output_tokens_1m', '12.00'),
    rate('aurora-mini.in', demoItemId('model', 'aurora-mini'), 'input_tokens_1m', '0.40'),
    // Deliberately expired: demonstrates that stale rates are excluded and coverage becomes partial.
    rate('aurora-mini.out', demoItemId('model', 'aurora-mini'), 'output_tokens_1m', '1.60', {
      valid_from: '2026-01-01T00:00:00Z',
      valid_until: '2026-06-30T23:59:59Z',
    }),
    rate('nimbus-1x-c24.gpu', demoItemId('compute_profile', 'nimbus-1x-c24'), 'gpu_hour', '1.10', {
      region: 'us-east-demo',
    }),
    rate('nimbus-4x-c80.gpu', demoItemId('compute_profile', 'nimbus-4x-c80'), 'gpu_hour', '3.90', {
      region: 'us-east-demo',
    }),
    rate('storage-object', demoItemId('storage', 'object'), 'storage_gb_month', '0.02'),
    rate('storage-block', demoItemId('storage', 'block'), 'storage_gb_month', '0.08'),
    rate('embed-1536', demoItemId('embedding_model', 'embed-1536'), 'embedding_tokens_1m', '0.10'),
    rate('vectorstore', demoItemId('vector_database', 'vectorstore'), 'vector_gb_month', '0.30'),
    rate('nimbus-burst.gpu', demoItemId('training_compute', 'nimbus-burst'), 'gpu_hour', '3.90'),
  ],
};

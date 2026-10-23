import { Link } from 'react-router';
import { PartsHead } from '../../components/PartsHead';
import { Loading } from '../../components/feedback';

export const BUILDER_DESCRIPTION =
  'One row per component slot, in dependency order. Prices and compatibility come from synthetic demo data; nothing here is a quote or a vendor specification.';

/** Keep the page identity visible while either editor code or build data loads. */
export function BuilderLoading() {
  return (
    <div className="app-page parts-page">
      <div className="container">
        <PartsHead
          crumbs={
            <>
              <Link to="/">PickYour.AI</Link> <span>/</span> Builder
            </>
          }
          title="Choose your parts"
          description={BUILDER_DESCRIPTION}
        />
        <Loading label="Loading the parts register…" />
      </div>
    </div>
  );
}

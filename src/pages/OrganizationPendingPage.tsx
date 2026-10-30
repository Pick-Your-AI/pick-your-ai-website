/*
 * /organization while no reviewed directory bundle has been admitted.
 *
 * When a bundle is admitted (contracts/organization/PIN.json, docs/ORGANIZATION_DIRECTORY.md) the
 * host serves the static public/organization/index.html for /organization/ and this route is never
 * reached from the address bar. It deliberately contains no organization data and no renderer of its
 * own: the canonical directory is generated and reviewed in Pick-Your-AI/.github.
 */
import { PageHeader } from '../components/layout';
import { Notice } from '../components/feedback';
import { ESCALATION_POLICY, ORGANIZATION_OPERATION } from '../lib/organization';

export default function OrganizationPendingPage() {
  return (
    <div className="app-page">
      <PageHeader
        compact
        breadcrumb="ORGANIZATION"
        eyebrow="ORGANIZATION"
        title="Organization directory"
      >
        Teams, repositories and Projects in one maintained directory.
      </PageHeader>
      <div className="container legal-content">
        <Notice title="Not published yet.">
          The directory of the organization&apos;s teams, repositories and Projects is not on this
          site yet. It is produced and reviewed in the organization&apos;s{' '}
          <code className="mono">.github</code> repository, and nothing appears here until a
          reviewed version has been approved for release. Until then this page shows no organization
          data.
        </Notice>

        <section className="method-chapter" aria-labelledby="meanwhile">
          <div className="chapter-index">01 / MEANWHILE</div>
          <h2 id="meanwhile">Where to look until then</h2>
          <ul className="legal-list">
            <li>
              The{' '}
              <a className="text-link" href={ESCALATION_POLICY}>
                canonical escalation policy
              </a>{' '}
              defines who to ask, in order: repository team, repository maintainer, repository lead
              maintainer, applicable parent teams, then CompleteDotTech.
            </li>
            <li>
              <a className="text-link" href={ORGANIZATION_OPERATION}>
                How the directory is refreshed, reviewed and published
              </a>
              , including how to read unmapped entities and stale data.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

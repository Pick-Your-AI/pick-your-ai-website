/*
 * Privacy and terms. Styled with the design mock's masthead + chapter treatment; the wording is
 * the project's existing plain-language notice (no analytics, no accounts, local-only storage).
 */
import { PageHeader } from '../components/layout';
import { Notice } from '../components/feedback';

const SITE_REPO = 'https://github.com/Pick-Your-AI/pickyour.ai';

export default function LegalPage() {
  return (
    <div className="app-page">
      <PageHeader compact breadcrumb="LEGAL" eyebrow="LEGAL" title="Privacy and terms">
        A plain-language notice for the PickYour.AI preview. Last updated{' '}
        <time dateTime="2026-10-16">2026-10-16</time>.
      </PageHeader>
      <div className="container legal-content">
        <Notice title="Preview notice.">
          This page describes how the preview works today. It will be revised before the site uses
          real catalog data or adds any feature that changes what is collected.
        </Notice>

        <section className="method-chapter" aria-labelledby="privacy">
          <div className="chapter-index">01 / PRIVACY</div>
          <h2 id="privacy">Privacy</h2>
          <ul className="legal-list">
            <li>
              <strong>No accounts.</strong> You do not sign up or sign in.
            </li>
            <li>
              <strong>No cookies, analytics or trackers.</strong> The site loads no analytics,
              advertising or third-party scripts. Typefaces are self-hosted, so a page load makes no
              request to any other origin.
            </li>
            <li>
              <strong>Your builds stay in this browser.</strong> Builds and preferences such as the
              colour theme are saved in this browser&apos;s local storage under keys starting with{' '}
              <code className="mono">pyai.</code>. They are not sent to us. Clearing your site data
              removes them.
            </li>
            <li>
              <strong>Share links carry the build in the URL fragment</strong> (the part after{' '}
              <code className="mono">#</code>). Browsers do not send the fragment to the server, so
              the build is only visible to people you give the link to.
            </li>
            <li>
              <strong>Server logs.</strong> Like most websites, the hosting provider&apos;s web
              servers may record standard request logs, such as IP address, user agent, requested
              page and time, for operation and security.
            </li>
          </ul>
        </section>

        <section className="method-chapter" aria-labelledby="terms">
          <div className="chapter-index">02 / TERMS OF USE</div>
          <h2 id="terms">Terms of use</h2>
          <ul className="legal-list">
            <li>
              The preview is provided <strong>as is, without warranty</strong> of any kind. It may
              change or be unavailable at any time.
            </li>
            <li>
              The demo data is <strong>synthetic</strong>. Nothing on the site is advice, a
              recommendation, a price quote or a statement about a real product. Verify anything
              important with the relevant vendor before you rely on it.
            </li>
            <li>
              PickYour.AI is independent. Naming a vendor or product in future catalog data does not
              imply any affiliation, sponsorship or endorsement.
            </li>
            <li>
              The website source code is available under the{' '}
              <a className="text-link" href={`${SITE_REPO}/blob/main/LICENSE`}>
                MIT licence
              </a>
              .
            </li>
          </ul>
        </section>

        <section className="method-chapter" aria-labelledby="contact">
          <div className="chapter-index">03 / CONTACT</div>
          <h2 id="contact">Contact</h2>
          <p>
            For questions about this notice, open an issue on{' '}
            <a className="text-link" href={`${SITE_REPO}/issues`}>
              the website&apos;s GitHub issue tracker
            </a>
            . Please do not post personal information there.
          </p>
        </section>
      </div>
    </div>
  );
}

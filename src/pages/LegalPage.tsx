import { PageHeader } from '../components/layout';
import { Notice } from '../components/feedback';

const SITE_REPO = 'https://github.com/Pick-Your-AI/pickyour.ai';

export default function LegalPage() {
  return (
    <>
      <PageHeader eyebrow="Legal" title="Privacy and terms">
        A plain-language notice for the PickYour.AI preview. Last updated{' '}
        <time dateTime="2026-10-16">2026-10-16</time>.
      </PageHeader>
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="prose-doc">
          <Notice title="Preview notice.">
            This page describes how the preview works today. It will be revised before the site uses
            real catalog data or adds any feature that changes what is collected.
          </Notice>

          <nav aria-label="On this page">
            <ul className="flex flex-wrap gap-x-4 list-none pl-0 text-sm">
              <li>
                <a className="link" href="#privacy">
                  Privacy
                </a>
              </li>
              <li>
                <a className="link" href="#terms">
                  Terms of use
                </a>
              </li>
            </ul>
          </nav>

          <section aria-labelledby="privacy">
            <h2 id="privacy" className="scroll-mt-4">
              Privacy
            </h2>
            <ul>
              <li>
                <strong>No accounts.</strong> You do not sign up or sign in.
              </li>
              <li>
                <strong>No cookies, analytics or trackers.</strong> The site loads no third-party
                scripts, fonts or advertising.
              </li>
              <li>
                <strong>Your builds stay in this browser.</strong> Builds and preferences such as
                the colour theme are saved in this browser&apos;s local storage under keys starting
                with <code>pyai.</code>. They are not sent to us. Clearing your site data removes
                them.
              </li>
              <li>
                <strong>Share links carry the build in the URL fragment</strong> (the part after{' '}
                <code>#</code>). Browsers do not send the fragment to the server, so the build is
                only visible to people you give the link to.
              </li>
              <li>
                <strong>Server logs.</strong> Like most websites, the hosting provider&apos;s web
                servers may record standard request logs, such as IP address, user agent, requested
                page and time, for operation and security.
              </li>
            </ul>
          </section>

          <section aria-labelledby="terms">
            <h2 id="terms" className="scroll-mt-4">
              Terms of use
            </h2>
            <ul>
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
                PickYour.AI is independent. Naming a vendor or product in future catalog data does
                not imply any affiliation, sponsorship or endorsement.
              </li>
              <li>
                The website source code is available under the{' '}
                <a className="link" href={`${SITE_REPO}/blob/main/LICENSE`}>
                  MIT licence
                </a>
                .
              </li>
            </ul>
          </section>

          <section aria-labelledby="contact">
            <h2 id="contact">Contact</h2>
            <p>
              For questions about this notice, open an issue on{' '}
              <a className="link" href={`${SITE_REPO}/issues`}>
                the website&apos;s GitHub issue tracker
              </a>
              . Please do not post personal information there.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

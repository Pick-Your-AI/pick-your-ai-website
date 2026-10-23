/*
 * About. Structure, copy and class names are ported from the approved design mock
 * (`docs/design/pickyourai-complete.html`, `#aboutScreen`). The mock's roadmap and FAQ answers are design
 * placeholders; the answers here describe what this build actually does (synthetic data, local-only
 * builds, no account, no live pricing) and link to the real project repositories.
 */
import { Link } from 'react-router';
import { Icon, type IconName } from '../components/icon';

const ORG = 'https://github.com/Pick-Your-AI';
const SITE_REPO = `${ORG}/pickyour.ai`;
const RESEARCH_REPO = `${ORG}/pick-your-ai-research`;

const VALUES: { number: string; icon: IconName; title: string; copy: string }[] = [
  {
    number: '01',
    icon: 'layers',
    title: 'Systems over products',
    copy: 'Show the entire architecture, not just an isolated model or accelerator — and how each layer constrains the next.',
  },
  {
    number: '02',
    icon: 'shield',
    title: 'Explain every warning',
    copy: 'Make the assumptions and dependencies behind a finding visible, with the rule id and the condition that produced it.',
  },
  {
    number: '03',
    icon: 'chart',
    title: 'Uncertainty is data',
    copy: 'Unknown compatibility and missing price evidence are called out, never smoothed over or presented as a pass.',
  },
];

const ROADMAP = [
  {
    marker: '01',
    done: true,
    title: 'Experience concept',
    detail: 'Interactive building and comparison flows on synthetic data',
    state: 'THIS PREVIEW',
  },
  {
    marker: '02',
    done: false,
    title: 'Verified product records',
    detail: 'Versions, sources, licensing and cost coverage for the real catalog',
  },
  {
    marker: '03',
    done: false,
    title: 'Research-backed compatibility',
    detail: 'Published, traceable rules with coverage and unknowns',
  },
  {
    marker: '04',
    done: false,
    title: 'Workload-aware estimates',
    detail: 'Documented assumptions and benchmark evidence',
  },
];

export default function AboutPage() {
  return (
    <>
      <div className="page-masthead about-masthead">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">PICKYOUR.AI</Link>
            <span>/</span> ABOUT
          </div>
          <div className="about-eyebrow">
            <span className="live-dot" /> BUILT FOR PEOPLE WHO BUILD
          </div>
          <h1>
            AI is complicated.
            <br />
            <span>Choosing your stack</span>
            <br />
            shouldn&apos;t be.
          </h1>
          <p>
            Models. Runtimes. GPUs. Databases. Agents. Deployment. They all affect one another.
            PickYour.AI explores what happens when you put those decisions into a single,
            understandable workflow.
          </p>
          <Link className="btn btn-primary" to="/builder">
            Explore the builder <Icon name="arrow-right" />
          </Link>
        </div>
      </div>
      <div className="container about-content">
        <div className="about-manifesto">
          <div className="eyebrow">THE IDEA</div>
          <div>
            <h2>Less marketing. More clarity.</h2>
            <p>
              Picking components for an AI project shouldn&apos;t require twenty browser tabs,
              disconnected benchmark charts, and the hope that everything will work together. We
              want architecture decisions to feel as understandable as building a PC.
            </p>
            <p>
              PickYour.AI aims to be for AI stacks what PCPartPicker is for computers — a place to
              pick components, see whether they fit, and understand what is missing and what it may
              cost. PickYour.AI has its own identity and is <strong>not affiliated with</strong>,
              endorsed by, or connected to PCPartPicker; the comparison describes the idea only.
            </p>
            <p>
              A good tool doesn&apos;t just tell you what to pick. It explains{' '}
              <strong>why a choice fits, what it costs, and what remains uncertain.</strong>
            </p>
          </div>
        </div>
        <div className="values-heading">
          <span className="eyebrow">WHAT WE BELIEVE</span>
          <h2>Built on useful principles.</h2>
        </div>
        <div className="values-grid">
          {VALUES.map((value) => (
            <div className="value-tile" key={value.number}>
              <span className="value-number">{value.number}</span>
              <Icon name={value.icon} />
              <h3>{value.title}</h3>
              <p>{value.copy}</p>
            </div>
          ))}
        </div>
        <div className="roadmap">
          <div>
            <span className="eyebrow">THE PATH FORWARD</span>
            <h2>From preview to decision platform.</h2>
            <p>
              This experience is a front-end concept running on synthetic demo data. A production
              release requires a continuously maintained evidence catalog and verified integration
              rules — see{' '}
              <Link className="text-link" to="/methodology#data">
                what this deployment is running
              </Link>
              .
            </p>
          </div>
          <div className="roadmap-steps">
            {ROADMAP.map((step) => (
              <div key={step.marker}>
                <span className={step.done ? 'roadmap-marker done' : 'roadmap-marker'}>
                  {step.marker}
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <small>{step.detail}</small>
                </div>
                {step.state ? <span className="roadmap-state">{step.state}</span> : null}
              </div>
            ))}
          </div>
        </div>
        <div className="faq-section">
          <div className="eyebrow">FREQUENT QUESTIONS</div>
          <h2>The important details.</h2>
          <details>
            <summary>Does the preview validate real hardware or software compatibility?</summary>
            <p>
              No. The checker evaluates the published baseline ruleset against synthetic demo items,
              so it demonstrates how rule-based dependencies are surfaced — not a continuously
              researched support matrix. When the evidence for a check is missing the result is
              reported as unknown, never as compatible. Read the{' '}
              <Link className="text-link" to="/methodology#compatibility">
                methodology
              </Link>{' '}
              for the exact semantics.
            </p>
          </details>
          <details>
            <summary>Are the prices and benchmarks live?</summary>
            <p>
              No. Every amount is a synthetic monthly placeholder, not a vendor quote, and there is
              no benchmark or pricing feed. Components without a rate are shown as{' '}
              <strong>Unknown</strong> rather than as zero, and amounts in different currencies are
              never converted or summed.
            </p>
          </details>
          <details>
            <summary>Can I save my builds?</summary>
            <p>
              Yes, within this browser. Builds are saved in local storage under keys starting with{' '}
              <code>pyai.</code> and can be exported as JSON for portability. Nothing is uploaded,
              and clearing your site data removes them.
            </p>
          </details>
          <details>
            <summary>Can I use it without creating an account?</summary>
            <p>
              Yes. There is no account, no sign-in and no server-side storage of your
              configurations. The site runs entirely in your browser.
            </p>
          </details>
          <details>
            <summary>Is this affiliated with PCPartPicker?</summary>
            <p>
              No. PickYour.AI is an independent open project. PCPartPicker is mentioned only as an
              analogy for the kind of tool we want to build, and naming it implies no affiliation,
              sponsorship or endorsement in either direction.
            </p>
          </details>
          <details>
            <summary>How is the project organised?</summary>
            <p>
              The{' '}
              <a className="text-link" href={RESEARCH_REPO}>
                research repository
              </a>{' '}
              defines the component taxonomy, the data contracts, the dependency graph and the
              compatibility rules; this website consumes those contracts and does not define its own
              rules. Research is tracked in{' '}
              <a className="text-link" href={`${ORG}/projects/1`}>
                Project #1: AI Builder Research
              </a>{' '}
              and{' '}
              <a className="text-link" href={`${ORG}/projects/2`}>
                Project #2: Market Research
              </a>
              . The{' '}
              <a className="text-link" href={SITE_REPO}>
                website source
              </a>{' '}
              is open and MIT-licensed.
            </p>
          </details>
          <details>
            <summary>How can I contribute?</summary>
            <p>
              Report a problem with the site in{' '}
              <a className="text-link" href={`${SITE_REPO}/issues`}>
                website issues
              </a>
              , propose components, rules or evidence in{' '}
              <a className="text-link" href={`${RESEARCH_REPO}/issues`}>
                research issues
              </a>
              , and read the{' '}
              <a className="text-link" href={`${SITE_REPO}/blob/main/CONTRIBUTING.md`}>
                contributing guide
              </a>{' '}
              before opening a pull request.
            </p>
          </details>
          <details>
            <summary>Where do the illustrations come from?</summary>
            <p>
              The home page illustration, the empty-builder illustration and the social sharing
              image were generated with OpenAI Codex (GPT Image). Each asset is recorded in{' '}
              <a className="text-link" href={`${SITE_REPO}/blob/main/docs/ASSETS.md`}>
                docs/ASSETS.md
              </a>
              .
            </p>
          </details>
        </div>
        <div className="about-cta">
          <div>
            <span className="eyebrow">YOUR NEXT BUILD STARTS HERE</span>
            <h2>Make every layer count.</h2>
            <p>Start with a template or build something entirely your own.</p>
          </div>
          <Link className="btn btn-primary" to="/builder">
            Open the stack builder →
          </Link>
        </div>
      </div>
    </>
  );
}

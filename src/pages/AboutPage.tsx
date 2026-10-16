import { Link } from 'react-router';
import { PageHeader } from '../components/layout';

const ORG = 'https://github.com/Pick-Your-AI';
const SITE_REPO = `${ORG}/pickyour.ai`;
const RESEARCH_REPO = `${ORG}/pick-your-ai-research`;

export default function AboutPage() {
  return (
    <>
      <PageHeader eyebrow="About" title="About PickYour.AI">
        An open project to make assembling an AI system as clear as assembling a PC.
      </PageHeader>
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="prose-doc">
          <section aria-labelledby="mission">
            <h2 id="mission">Mission</h2>
            <p>
              Building with AI means choosing many parts that must work together: a model, where it
              runs, how it retrieves knowledge, which tools it may use, and how it is guarded and
              monitored. PickYour.AI aims to be for AI stacks what PCPartPicker is for computers — a
              place to pick components, see whether they fit, and understand what is missing and
              what it may cost.
            </p>
            <p>
              PickYour.AI has its own identity and is <strong>not affiliated with</strong>, endorsed
              by, or connected to PCPartPicker. The comparison describes the idea only.
            </p>
          </section>

          <section aria-labelledby="context">
            <h2 id="context">How the project is organised</h2>
            <ul>
              <li>
                The{' '}
                <a className="link" href={RESEARCH_REPO}>
                  research repository
                </a>{' '}
                defines the component taxonomy, the data contracts, the dependency graph and the
                compatibility rules. This website consumes those contracts and does not define its
                own rules.
              </li>
              <li>
                Research is tracked in two GitHub projects:{' '}
                <a className="link" href={`${ORG}/projects/1`}>
                  Project #1: AI Builder Research
                </a>{' '}
                and{' '}
                <a className="link" href={`${ORG}/projects/2`}>
                  Project #2: Market Research
                </a>
                .
              </li>
              <li>
                The{' '}
                <a className="link" href={SITE_REPO}>
                  website source
                </a>{' '}
                is open and MIT-licensed.
              </li>
            </ul>
          </section>

          <section aria-labelledby="status">
            <h2 id="status">Current status</h2>
            <p>
              This is a <strong>preview</strong>. The builder, catalog, compare and sharing features
              work, but they run on <strong>synthetic demonstration data</strong>. No component,
              price, benchmark or compatibility result shown today describes a real product. The
              real catalog is still being researched and will replace the demo data once it is
              published with evidence. See{' '}
              <Link className="link" to="/methodology#data">
                data and demo mode
              </Link>{' '}
              for details.
            </p>
          </section>

          <section aria-labelledby="contribute">
            <h2 id="contribute">How to contribute</h2>
            <ul>
              <li>
                Report a problem or suggest an improvement to the site in{' '}
                <a className="link" href={`${SITE_REPO}/issues`}>
                  website issues
                </a>
                .
              </li>
              <li>
                Propose or discuss components, rules and evidence in{' '}
                <a className="link" href={`${RESEARCH_REPO}/issues`}>
                  research issues
                </a>
                .
              </li>
              <li>
                Read the{' '}
                <a className="link" href={`${SITE_REPO}/blob/main/CONTRIBUTING.md`}>
                  contributing guide
                </a>{' '}
                before opening a pull request.
              </li>
            </ul>
          </section>

          <section aria-labelledby="credits">
            <h2 id="credits">Image credits</h2>
            <p>
              The home page illustration, the empty-builder illustration and the social sharing
              image were generated with OpenAI Codex (GPT Image). Details of each asset are recorded
              in{' '}
              <a className="link" href={`${SITE_REPO}/blob/main/docs/ASSETS.md`}>
                docs/ASSETS.md
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

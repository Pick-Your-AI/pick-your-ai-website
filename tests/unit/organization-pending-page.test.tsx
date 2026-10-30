import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import OrganizationPendingPage from '../../src/pages/OrganizationPendingPage';
import {
  ESCALATION_POLICY,
  ORGANIZATION_DIRECTORY_PATH,
  ORGANIZATION_OPERATION,
} from '../../src/lib/organization';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/organization']}>
      <OrganizationPendingPage />
    </MemoryRouter>,
  );
}

describe('/organization before a reviewed bundle is admitted', () => {
  it('has one heading and says plainly that nothing has been published', () => {
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Organization directory');
    expect(screen.getByText(/Not published yet\./)).toBeInTheDocument();
    expect(screen.getByText(/is not on this site yet/)).toBeInTheDocument();
    expect(screen.getByText(/shows no\s+organization data/)).toBeInTheDocument();
  });

  it('carries no organization data of its own', () => {
    const { container } = renderPage();
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('input, select')).toBeNull();
    expect(container.textContent).not.toMatch(/\b(?:Lead Maintainers|Review Leads)\b/);
  });

  it('links only to the canonical policy and operation documents', () => {
    renderPage();
    const hrefs = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'))
      .filter((href) => href?.startsWith('http'));
    expect(hrefs).toEqual([ESCALATION_POLICY, ORGANIZATION_OPERATION]);
    const policy = screen.getByRole('link', { name: 'canonical escalation policy' });
    expect(policy).toHaveAttribute('href', ESCALATION_POLICY);
    const main = policy.closest('section')!;
    expect(within(main).getAllByRole('link')).toHaveLength(2);
  });
});

describe('organization links', () => {
  it('point at the organization repository and the static directory path', () => {
    expect(ESCALATION_POLICY).toBe(
      'https://github.com/Pick-Your-AI/.github/blob/main/docs/governance/ESCALATION.md',
    );
    expect(ORGANIZATION_OPERATION).toMatch(/^https:\/\/github\.com\/Pick-Your-AI\/\.github\//);
    // A trailing slash is required: the static page loads directory.js relatively.
    expect(ORGANIZATION_DIRECTORY_PATH).toBe('/organization/');
  });
});

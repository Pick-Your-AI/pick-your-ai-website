/**
 * Links to the canonical organization policy and directory documentation. The website links to
 * these documents; it neither copies their content nor defines its own organization registry.
 */
const ORG_GITHUB = 'https://github.com/Pick-Your-AI/.github';

export const ESCALATION_POLICY = `${ORG_GITHUB}/blob/main/docs/governance/ESCALATION.md`;
export const ORGANIZATION_OPERATION = `${ORG_GITHUB}/blob/main/docs/ORGANIZATION.md`;

/** The static, separately served directory. Link with a plain anchor, never a router `Link`. */
export const ORGANIZATION_DIRECTORY_PATH = '/organization/';

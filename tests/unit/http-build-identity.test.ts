import { describe, expect, it, vi } from 'vitest';
import { validateContract, validatorsReady, type BuildSnapshot } from '../../src/contracts';
import { ContractHttpClient } from '../../src/data/http/client';
import { HttpBuildRepository } from '../../src/data/http/providers';
import { LocalBuildRepository, type KeyValueStorage } from '../../src/data/local-builds';
import { createDraft } from '../../src/domain/build';
import { apiChat } from './scenarios';

const baseUrl = 'https://api.test/v1';
const requestedId = 'build:requested';
const requestedPath = '/builds/build%3Arequested';
const build = (revision: number, id = requestedId): BuildSnapshot => ({
  ...apiChat(),
  id,
  revision,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function harness(body: unknown, status = 200) {
  const rows = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => void rows.set(key, value),
    removeItem: (key) => void rows.delete(key),
  };
  const local = new LocalBuildRepository(storage);
  const fetch = vi.fn(async () => json(body, status));
  const repository = new HttpBuildRepository(new ContractHttpClient({ baseUrl, fetch }), local);
  return { rows, local, fetch, repository };
}

async function assertValid(value: BuildSnapshot) {
  await validatorsReady;
  expect(validateContract('BuildSnapshot', value).ok).toBe(true);
}

async function seed(h: ReturnType<typeof harness>) {
  await h.local.save(createDraft(build(8, 'build.foreign')), null);
  await h.local.save(createDraft(build(3, 'build.unrelated')), null);
}

describe('HTTP build reads bind the requested ID', () => {
  it.each([1, 17])('accepts the requested current head at revision %i', async (revision) => {
    const response = build(revision);
    await assertValid(response);
    const h = harness(response);

    await expect(h.repository.get(requestedId)).resolves.toEqual({
      build: response,
      revisions: [response],
      changes: [],
    });
    expect(h.fetch).toHaveBeenCalledWith(
      baseUrl + requestedPath,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(h.rows.size).toBe(0);
  });

  it('rejects a schema-valid foreign head without altering the local index', async () => {
    const response = build(17, 'build.foreign');
    await assertValid(response);
    const h = harness(response);
    await seed(h);
    const before = [...h.rows];

    await expect(h.repository.get(requestedId)).rejects.toMatchObject({
      kind: 'malformed',
      contract: 'BuildSnapshot',
    });
    expect([...h.rows]).toEqual(before);
  });
});

const writes = [
  { name: 'create', method: 'POST', expectedRevision: null, revision: 1, status: 201 },
  { name: 'update', method: 'PUT', expectedRevision: 4, revision: 5, status: 200 },
] as const;

// Frozen v1 POST creates revision 1; PUT's quoted If-Match requires the next
// candidate revision. These cases use valid candidates and independently vary
// only the schema-valid response identity or revision.
for (const write of writes) {
  describe('HTTP build ' + write.name + ' response binding', () => {
    it('accepts the exact submitted identity and revision, preserving history and headers', async () => {
      const candidate = createDraft(build(write.revision));
      if (write.expectedRevision !== null) {
        candidate.revisions.unshift(build(write.expectedRevision));
      }
      await assertValid(candidate.build);
      const before = structuredClone(candidate);
      const h = harness(candidate.build, write.status);
      await seed(h);

      await expect(h.repository.save(candidate, write.expectedRevision)).resolves.toEqual(
        candidate,
      );
      await expect(h.local.get(requestedId)).resolves.toEqual(candidate);
      await expect(h.local.get('build.foreign')).resolves.toEqual(
        createDraft(build(8, 'build.foreign')),
      );
      expect(candidate).toEqual(before);
      expect(h.fetch).toHaveBeenCalledWith(
        baseUrl + (write.method === 'POST' ? '/builds' : requestedPath),
        expect.objectContaining({
          method: write.method,
          body: JSON.stringify(candidate.build),
          headers: expect.objectContaining({
            'Idempotency-Key': expect.any(String),
            ...(write.expectedRevision === null ? {} : { 'If-Match': '"4"' }),
          }),
        }),
      );
    });

    const mismatches = [
      { name: 'foreign ID', response: build(write.revision, 'build.foreign') },
      { name: 'later revision', response: build(write.revision + 1) },
      ...(write.expectedRevision === null
        ? []
        : [{ name: 'stale revision', response: build(write.expectedRevision) }]),
    ];
    it.each(mismatches)('rejects $name before any local cache write', async ({ response }) => {
      await assertValid(response);
      const candidate = createDraft(build(write.revision));
      if (write.expectedRevision !== null) {
        candidate.revisions.unshift(build(write.expectedRevision));
      }
      const candidateBefore = structuredClone(candidate);
      const h = harness(response, write.status);
      await seed(h);
      if (write.expectedRevision !== null) {
        await h.local.save(createDraft(build(write.expectedRevision)), null);
      }
      const storageBefore = [...h.rows];

      const result = await h.repository.save(candidate, write.expectedRevision).then(
        () => null,
        (error: unknown) => error,
      );
      expect.soft(result).toMatchObject({ kind: 'malformed', contract: 'BuildSnapshot' });
      expect.soft([...h.rows]).toEqual(storageBefore);
      expect(candidate).toEqual(candidateBefore);
    });
  });
}

describe('HTTP build candidates obey the frozen revision protocol before dispatch', () => {
  const invalid = [
    { name: 'create above revision one', revision: 2, expectedRevision: null },
    { name: 'update repeats the saved revision', revision: 4, expectedRevision: 4 },
    { name: 'update skips a revision', revision: 6, expectedRevision: 4 },
    { name: 'zero saved revision', revision: 1, expectedRevision: 0 },
    { name: 'fractional saved revision', revision: 5, expectedRevision: 4.5 },
    { name: 'NaN saved revision', revision: 5, expectedRevision: Number.NaN },
    { name: 'infinite saved revision', revision: 5, expectedRevision: Number.POSITIVE_INFINITY },
    {
      name: 'saved revision whose increment rounds back to itself',
      revision: Number.MAX_SAFE_INTEGER + 1,
      expectedRevision: Number.MAX_SAFE_INTEGER + 1,
    },
  ];

  it.each(invalid)('rejects $name without HTTP or local writes', async (invalid) => {
    const candidate = createDraft(build(invalid.revision));
    await assertValid(candidate.build);
    const before = structuredClone(candidate);
    const h = harness(candidate.build, invalid.expectedRevision === null ? 201 : 200);
    await seed(h);
    const storageBefore = [...h.rows];

    const result = await h.repository.save(candidate, invalid.expectedRevision).then(
      () => null,
      (error: unknown) => error,
    );
    expect.soft(result).toMatchObject({ kind: 'malformed', contract: 'BuildSnapshot' });
    expect.soft(h.fetch).not.toHaveBeenCalled();
    expect.soft([...h.rows]).toEqual(storageBefore);
    expect(candidate).toEqual(before);
  });

  it('allows the exact next revision after the largest safe saved integer', async () => {
    const candidate = createDraft(build(Number.MAX_SAFE_INTEGER + 1));
    await assertValid(candidate.build);
    const h = harness(candidate.build);

    await expect(h.repository.save(candidate, Number.MAX_SAFE_INTEGER)).resolves.toEqual(candidate);
    expect(h.fetch).toHaveBeenCalledWith(
      baseUrl + requestedPath,
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ 'If-Match': '"9007199254740991"' }),
      }),
    );
    await expect(h.local.get(requestedId)).resolves.toEqual(candidate);
  });

  it('binds the response to the identity serialized before an in-flight caller mutation', async () => {
    const candidate = createDraft(build(5));
    const response = build(6, 'build.foreign');
    await assertValid(response);
    const h = harness(response);
    await seed(h);
    const storageBefore = [...h.rows];
    let respond!: (response: Response) => void;
    h.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );

    const pending = h.repository.save(candidate, 4);
    expect(h.fetch).toHaveBeenCalledWith(
      baseUrl + requestedPath,
      expect.objectContaining({ body: JSON.stringify(candidate.build) }),
    );
    candidate.build.id = response.id;
    candidate.build.revision = response.revision;
    respond(json(response));

    await expect(pending).rejects.toMatchObject({ kind: 'malformed', contract: 'BuildSnapshot' });
    expect([...h.rows]).toEqual(storageBefore);
  });
});

describe('HTTP build transport errors preserve the local cache', () => {
  it('preserves an HTTP 404 on read', async () => {
    const h = harness({ code: 'not_found', message: 'missing build' }, 404);
    await seed(h);
    const before = [...h.rows];
    await expect(h.repository.get(requestedId)).rejects.toMatchObject({
      kind: 'not_found',
      status: 404,
    });
    expect([...h.rows]).toEqual(before);
  });

  it('preserves an HTTP 409 on update without advancing the cached revision', async () => {
    const h = harness({ code: 'conflict', message: 'stale writer' }, 409);
    await seed(h);
    await h.local.save(createDraft(build(4)), null);
    const before = [...h.rows];
    await expect(h.repository.save(createDraft(build(5)), 4)).rejects.toMatchObject({
      kind: 'conflict',
      status: 409,
    });
    expect([...h.rows]).toEqual(before);
  });
});

import { ArgumentMetadata, UnprocessableEntityException } from '@nestjs/common';
import { createValidationPipe } from '@libs/shared/utils';
import { FindAllInvoicesDto } from './find-invoices.dto';

// The same pipe bff and the invoice service register globally, so this exercises query parsing,
// type coercion, and the cross-field rules exactly as an HTTP request would.
const pipe = createValidationPipe();
const metadata: ArgumentMetadata = { type: 'query', metatype: FindAllInvoicesDto };
const parse = (query: Record<string, string>) => pipe.transform(query, metadata) as Promise<FindAllInvoicesDto>;

async function errorsFor(query: Record<string, string>): Promise<string> {
  try {
    await parse(query);
  } catch (error) {
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    return JSON.stringify((error as UnprocessableEntityException).getResponse());
  }
  throw new Error('expected validation to fail');
}

describe('FindAllInvoicesDto pagination rules', () => {
  it('defaults to offset mode: no pagination field, limit defaulted', async () => {
    await expect(parse({})).resolves.toMatchObject({ limit: 20 });
    expect((await parse({})).pagination).toBeUndefined();
  });

  it('accepts pagination=cursor on its own to start cursor pagination', async () => {
    await expect(parse({ pagination: 'cursor', limit: '5' })).resolves.toMatchObject({
      pagination: 'cursor',
      limit: 5,
    });
  });

  it('accepts pagination=cursor together with a cursor', async () => {
    await expect(parse({ pagination: 'cursor', cursor: 'abc' })).resolves.toMatchObject({ cursor: 'abc' });
  });

  it('rejects an unknown pagination mode', async () => {
    expect(await errorsFor({ pagination: 'keyset' })).toContain('pagination');
  });

  it('rejects pagination=cursor combined with page', async () => {
    expect(await errorsFor({ pagination: 'cursor', page: '2' })).toContain(
      '`pagination=cursor` cannot be combined with `page`.',
    );
  });

  it('rejects pagination=offset combined with a cursor', async () => {
    expect(await errorsFor({ pagination: 'offset', cursor: 'abc' })).toContain(
      '`pagination=offset` cannot be combined with `cursor`.',
    );
  });

  it('still rejects page and cursor together', async () => {
    expect(await errorsFor({ page: '1', cursor: 'abc' })).toContain('Cannot use both `cursor` and `page`');
  });
});

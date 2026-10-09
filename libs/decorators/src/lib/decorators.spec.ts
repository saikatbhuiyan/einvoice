import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { RequestParam } from './request-param.decorator';
import { Sanitize } from './sanitize.decorator';

describe('@Sanitize', () => {
  class Dto {
    @Sanitize()
    name!: unknown;

    @Sanitize({ stripHtml: false })
    notes!: unknown;

    @Sanitize({ normalizeWhitespace: false })
    address!: unknown;
  }

  it('strips HTML tags and collapses whitespace by default', () => {
    const dto = plainToInstance(Dto, { name: '  <script>alert(1)</script>Acme   <b>Ltd</b>  ' });

    expect(dto.name).toBe('alert(1)Acme Ltd');
  });

  it('can keep HTML or keep inner whitespace when asked, but always trims', () => {
    const dto = plainToInstance(Dto, { notes: '  <b>pay</b>   now ', address: ' Road 8,\n  Gulshan ' });

    expect(dto.notes).toBe('<b>pay</b> now');
    expect(dto.address).toBe('Road 8,\n  Gulshan');
  });

  it('leaves non-string values alone so validation, not sanitization, rejects them', () => {
    const dto = plainToInstance(Dto, { name: 42, notes: null, address: ['x'] });

    expect(dto).toMatchObject({ name: 42, notes: null, address: ['x'] });
  });
});

describe('@RequestParam', () => {
  // Nest stores a param decorator's factory in route-args metadata; pull it out to call directly.
  function factoryFor(data?: string): (data: string | undefined, ctx: ExecutionContext) => unknown {
    class Controller {
      handler(@RequestParam(data) _value: unknown) {
        return _value;
      }
    }
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Controller, 'handler');
    return args[Object.keys(args)[0]].factory;
  }

  const http = (params: Record<string, string>) =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ params }) }),
    }) as unknown as ExecutionContext;
  const rpc = (data: unknown) =>
    ({ getType: () => 'rpc', switchToRpc: () => ({ getData: () => data }) }) as unknown as ExecutionContext;

  it('reads one route param, or all of them, over HTTP', () => {
    expect(factoryFor('id')('id', http({ id: 'inv-1', other: 'x' }))).toBe('inv-1');
    expect(factoryFor()(undefined, http({ id: 'inv-1' }))).toEqual({ id: 'inv-1' });
  });

  it('reads the same field from the payload over RPC, so one handler signature serves both transports', () => {
    expect(factoryFor('id')('id', rpc({ id: 'inv-1' }))).toBe('inv-1');
    expect(factoryFor()(undefined, rpc({ id: 'inv-1' }))).toEqual({ id: 'inv-1' });
    expect(factoryFor('id')('id', rpc('raw-id'))).toBe('raw-id');
  });

  it('returns null for any other transport', () => {
    expect(factoryFor('id')('id', { getType: () => 'ws' } as unknown as ExecutionContext)).toBeNull();
  });
});

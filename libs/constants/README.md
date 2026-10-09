# constants

This library was generated with [Nx](https://nx.dev).

Plain shared values only (ports, pagination and rate-limit defaults, timeouts) with no logic, so it
has no test target. If a constant ever grows logic, add a `jest.config.cts` + `tsconfig.spec.json`
(copy them from `libs/transports`) along with the first spec.

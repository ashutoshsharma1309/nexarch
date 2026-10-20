# End-to-end suite

Three browser flows, each one a path that has actually broken in this project:

| Spec                        | What it proves                                                             |
| --------------------------- | -------------------------------------------------------------------------- |
| `console-loads.spec.ts`     | The console loads, the API reports operational, the Projects list renders. |
| `build-and-preview.spec.ts` | A prompt becomes a built project and the built project renders in preview. |
| `knowledge-graph.spec.ts`   | The graph renders nodes, search narrows them, a node's details open.       |

## Running them

```sh
npm run test:e2e:install   # once, to fetch the Chromium build
npm run dev                # in another terminal: these drive the real stack
npm run test:e2e
```

Nothing is mocked. The specs talk to the running server, which talks to
Postgres and to the AI provider, and the preview flow runs a real `npm
install` inside a generated project. Expect `build-and-preview` to take
several minutes; every wait in it is condition-based, so a fast machine
finishes fast.

If the console is not running at the base URL (`E2E_BASE_URL`, default
`http://localhost:5173`), every spec **skips** with the command that would
make it runnable. A clean checkout running `npm run test:e2e` gets an
explanation, not a wall of connection errors.

`knowledge-graph` needs a project that has already been built; it finds one
through the API and skips with a note when there is none.

## What CI does with them

CI typechecks these files and parses the suite. It does not run it: the flows
need a live server with a real AI key, and this repository has no such secret
configured. Pretending otherwise would produce a green check that means
nothing. See the `e2e-static` job in `.github/workflows/ci.yml`.

Reports and traces are written to `e2e/build/` — ignored by git, and named
`build` so the repo's existing `.prettierignore` entry keeps the generated
HTML report out of `npm run format:check`.

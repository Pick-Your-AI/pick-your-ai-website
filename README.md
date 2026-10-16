# PickYour.AI

**Build a compatible AI stack, part by part.** PickYour.AI is a builder for complete AI solutions in the spirit of a PC parts list: choose a workload and deployment mode, then models, infrastructure, retrieval, agents, training, and operations components, and see what is compatible, what is missing, and what is still unknown.

- Live site: https://pickyour.ai
- Research and contracts: [Pick-Your-AI/pick-your-ai-research](https://github.com/Pick-Your-AI/pick-your-ai-research)

> **Preview status.** The real component catalog is still being researched. Every component, price, and compatibility result on the site today is **synthetic demonstration data**, labelled as such. The data layer is ready to switch to validated research data without UI changes.

## Quick start

```sh
npm ci
npm run dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for scripts and workflow, and [AGENTS.md](AGENTS.md) for the rules every change must follow.

## Documentation

| Topic                                       | Document                                                   |
| ------------------------------------------- | ---------------------------------------------------------- |
| Architecture, data flow, state              | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)               |
| Research → website mapping and traceability | [docs/RESEARCH_MAPPING.md](docs/RESEARCH_MAPPING.md)       |
| Moving from fixtures to real data           | [docs/DATA_INTEGRATION.md](docs/DATA_INTEGRATION.md)       |
| Product, sitemap, journeys                  | [docs/PRODUCT.md](docs/PRODUCT.md)                         |
| Design system and accessibility             | [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)             |
| Testing strategy                            | [docs/TESTING.md](docs/TESTING.md)                         |
| Build contract for deployment               | [docs/DEPLOYMENT_CONTRACT.md](docs/DEPLOYMENT_CONTRACT.md) |
| Image asset provenance                      | [docs/ASSETS.md](docs/ASSETS.md)                           |
| Operations (deploy, DNS, rollback)          | [docs/operations/](docs/operations/)                       |

Some documents are added by later PRs; see `CHANGELOG.md`.

## License

[MIT](LICENSE)

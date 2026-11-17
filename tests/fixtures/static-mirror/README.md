# Offline static-mirror candidates

The `v1/` files here are unadmitted catalog and pricebook candidates, preserved byte-for-byte from the earlier public-path candidates. They are test inputs only, outside `public/` and deployable build output. Source/rights review, an admitted pricebook and receiving-owner acceptance remain outstanding; see `docs/PILOT_EVIDENCE.md`.

The unit-test GET transports map the two exact candidate endpoint paths to this directory. Baseline dependency graph and ruleset requests still read the unchanged `public/v1/` files. Logical `/v1` endpoint behavior is mocked; passing these tests does not prove publication or a live service.

Do not copy these candidates into `public/` or import them into application code as a substitute for artifact admission. Any future admitted release requires its own immutable identity and the receiving checklist in `docs/DATA_INTEGRATION.md` §4.

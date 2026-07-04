# Changelog

## [0.12.23] - 2026-07-04

### Changed

- refactor: remove preview CLI mode (47875afd49f1)

## [0.12.22] - 2026-07-03

### Changed

- Release metadata and deployment history updated.

## [0.12.21] - 2026-07-03

### Fixed

- Fix live hosting verify from reconcile state (f7a99de5b511)

## [0.12.20] - 2026-07-03

### Changed

- Release metadata and deployment history updated.

## [0.12.19] - 2026-07-03

### Changed

- Release metadata and deployment history updated.

## [0.12.18] - 2026-07-03

### Fixed

- fix: use https sdk git ref in lockfile (bd4699e3a2ff)
- chore: use latest sdk live verifier fix (a40f0818cb54)
- chore: use latest sdk staging reconciler fix (1829a0979ba2)
- chore: use sdk staging reconciler fix (e61778a99d6b)

### Dependencies

- chore: update sdk staging dependency (180609b6af2c)

## [0.12.17] - 2026-07-03

### Fixed

- fix: infer production hosting image refs (798724f7d03a)

## [0.12.16] - 2026-07-03

### Changed

- Release metadata and deployment history updated.

## [0.12.15] - 2026-07-03

### Changed

- Release metadata and deployment history updated.

## [0.12.14] - 2026-07-03

### Changed

- Load hosted API acceptance credentials from config (ce22a4c921d5)
- Honor hosting verification environment refs (1d7248faf6b6)

## [0.12.13] - 2026-07-03

### Infrastructure

- Trace release CLI phases (6a3fbf7fd0af)

## [0.12.12] - 2026-07-02

### Changed

- Release metadata and deployment history updated.

## [0.12.11] - 2026-07-02

### Changed

- Release metadata and deployment history updated.

## [0.12.10] - 2026-07-02

### Fixed

- fix(release): advance staging sdk lock recovery ref (3955923974ce)
- fix(release): advance staging sdk ref (0c299aaed2e7)
- fix(hosting): fail plans with blocked verification (092772500ad1)
- fix(release): advance staging sdk verification ref (7c7695860518)
- fix(release): advance staging sdk reference (1784a414a1f9)
- fix(release): restore staging dependency refs (d6bb265cd366)

### Infrastructure

- Wire cleanup and screenshot release options (03b16a756153)

## [0.12.9] - 2026-07-02

### Fixed

- fix(release): restore staging dependency refs (bfd53116fcdb)

## [0.12.8] - 2026-07-02

### Fixed

- fix(release): refresh SDK staging ref (d8f6a6df873d)
- fix(release): use staging SDK commit ref (f278a51edda1)

## [0.12.7] - 2026-07-02

### Changed

- Release metadata and deployment history updated.

## [0.12.6] - 2026-07-02

### Changed

- Release metadata and deployment history updated.

## [0.12.5] - 2026-07-02

### Changed

- Release metadata and deployment history updated.

## [0.12.4] - 2026-07-02

### Fixed

- fix(release): publish plain semver tags (b9a1b0997cce)

## [0.12.3] - 2026-07-02

### Changed

- Release metadata and deployment history updated.

## [0.12.2] - 2026-07-01

### Changed

- Release metadata and deployment history updated.

## [0.12.1] - 2026-07-01

### Changed

- Release metadata and deployment history updated.

## [0.12.0] - 2026-07-01

### Added

- feat(source): fix guarantees CLI help metadata (f61ab9c18bbb)

### Fixed

- build(build): fix image release root directory verification (7667cb1ced86)
- build(build): fix Railway runtime config verification (4775cc39ed8f)
- build(build): fix release guarantee API verifiers (fa6551340c73)
- build(build): fix staging release guarantee auth (fbf86838c14e)
- build(build): fix production release gates (447169a3b251)
- build(build): promotion proof after CI and acceptance fixes (03347521d14e)
- build(build): fix SDK proof regressions after guarantee framework (2bdaf80cc7ac)
- build(build): fix proof tests for clean hosted runners (a68360e33629)
- build(build): fix promotion release gate assertions (f31bf15fe077)
- build(build): fix TreeDX release gate Beam setup (7cd189c9ca04)
- build(build): fix scoped project domains for staging Pages (5b734d826dc1)
- build(build): fix Railway deploy live verification settle window (ab946475f820)
- build(build): fix Railway runtime secret sync for staging smoke (fa1bc202cb79)
- fix(cli): update @treeseed/sdk dependency (704386e40876)
- build(build): fix Railway IaC-only reconciliation and TreeDX env names (5064a0b79166)
- ci(build): fix Railway staging Dockerfile builds and persistent volumes (876aa231736c)
- build(build): fix staging Railway source builds and volumes (0e31d0c6c9bd)
- build(build): fix API staging source builds and runner volumes (f7a3de6005c0)
- build(build): fix api and agent staging source builds (82a287bf6dc2)
- build(build): fix api and agent staging source builds (4095b3fc4221)
- 18 additional changes omitted from this summary.

### Tests

- build(source): checkpoint user and team guarantees passing locally (823dc0464915)
- build(tests): switch hosted domains to treeseed.dev (11caa1548555)
- build(build): update stage command help text (1764e9a28e3f)
- build(build): rework stage promotion workflow (fd3b6d056362)
- build(docs): implement model-aware agent content tools (fdac5343417f)
- build(source): checkpoint before verify action and local dev stack (54c6e4635326)
- build(build): prepare linked runtime deps during cli release verify (40934290d27c)

### Dependencies

- build(build): allow first production API domain validation (a79d7e0d6919)
- build(build): merge package main history back to staging (d845f53f024f)
- build(build): replace legacy strict tail with proof ledger (f51f4540278e)
- build(source): implement incremental release proof (09e991f2c0d1)
- build(build): pin hosted workflow API domains to treeseed.dev (cfdac5ef9b1b)
- build(build): use configured API domains for hosted reconciliation (e24f2159b9b8)
- build(build): include domain units in promotion hosted reconciliation (2dd3a75b0974)
- build(build): harden Railway IaC reconciliation and domain verification (09596c6fa8c6)
- build(deps): repair managed worktree cleanup after docker verification (c27373b40955)
- build(build): harden action verification and document independent (9a725cb296b3)
- build(build): exclude build artifacts from stage proof workspace (e140f96321c7)
- build(build): use image-backed Railway API staging services (b2d9e343faf4)
- build(build): skip opaque railway sync provider errors after retries (5f36050d2029)
- build(build): tolerate railway deploy trigger processing errors (dca2cac1c921)
- build(build): retry transient railway hosted sync failures (a6113378f904)
- build(build): tolerate railway existing service source update limits (3de2744f6d85)
- build(build): repair railway existing service deployment recovery (6486dea5c177)
- build(build): implement proposal governance decision pipeline (2a6941fb14b5)
- build(build): remove legacy Mailpit dev hooks (23408401b694)
- build(build): restore Mailpit as reconciled local dev service (e74fc9dadbd8)
- 14 additional changes omitted from this summary.

## [0.11.0] - 2026-06-12

### Added

- feat(cli): add release candidate mode to save command (ba737eee3749)
- feat(cli): refine railway command context preselection (4846ea09e496)
- feat(cli): add hosting command (ee6aaa9740ed)
- feat(cli): add treedb command handlers and enhance status output (6a419b16d477)

### Changed

- Updates to the destroy command. (b71c82c9b39b)

### Fixed

- build(build): fix package deploy gate timeout and hybrid save validation (0cf2b779cc6b)
- build(build): fix package deploy gate timeout and hybrid save validation (4023cfa093e5)
- build(build): fix railway live deploy readiness retry (846d32240c13)
- build(build): fix staging web monitor and ui edge theme runtime (62d64ac35188)
- build(build): fix workspace deployment install readiness (962890e930a2)
- build(build): fix ui pages staging reconciliation (ab0e45c637ef)
- build(build): fix package app cloudflare auth (abcc76fb475f)
- build(build): fix package hosted config sync and api deploy environment (6968af0206a3)
- fix(cli): update sdk dependency and refresh lockfile (c42a059585e7)
- build(build): fix manifest package save gates (1efae720d476)
- build(build): complete Market API package migration hosted checker fix (c24404f73108)

### Tests

- build(build): stabilize github credential test for configured scoped (8a1f1cea4255)
- build(build): Save reconciliation platform and live acceptance updates (8f76757ad6f6)
- build(tests): Save reconciliation platform and live acceptance updates (22e8d1cd14df)
- build(source): Save reconciliation platform and live acceptance updates (24e81a46f1dd)
- build(source): document and harden staging release workflow (f1bbe45591ca)
- test(cli): show API package Railway roots (0a9b39042576)
- test(cli): expect package API Railway source root (a86c4baab1d0)
- build(release): complete Market API package migration (b104efa989dd)
- build(source): complete Market API package migration (d9fc6500f46d)
- refactor(cli): rename TreeDB to TreeDX (32c82e45783d)

### Dependencies

- build(build): stage package submodule restructuring (cee3b0432afb)
- build(build): document save lanes (7a9763aec8bb)
- build(build): add fast and promotion save lanes (3b1baedaf5c8)
- build(build): bound git dependency smoke checks (8b0c69edc3c2)
- build(build): build ui artifacts for hosted deploy (7c3f01223ba6)
- build(build): migrate reusable ui components to treeseed ui (7afa006293f5)
- build(build): integrate treeseed ui (39d2a5669e9d)
- build: update sdk package app dependency (ffc6eba169be)
- build: update sdk pages build dependency (81a97c0b0393)
- build: update sdk staging dependency (22977f754857)
- build(deps): update sdk hosted checks (6bc84233a2fa)
- build(deps): update sdk hosting dependency (7d318ecd3c01)
- build(build): make cli json output robust under capture (3ec70bd0841c)
- chore(cli): update version and @treeseed/sdk dependency (d4cd3302330c)
- build(build): Push clean hosted project repositories during save (a0a08cc0bd88)
- build(build): Install project dependencies before hosted project (cd7ee848b7fe)
- build(build): Install project dependencies before hosted project (1a4aa8947ef1)
- build(build): Install project dependencies before hosted project (7ee3c907730a)
- build(build): Treat API as a hosted project with verification gates (e430b2bc2abe)
- build(build): Move API deployment acceptance into API package (9a3566dfbeb0)
- 14 additional changes omitted from this summary.

## [0.10.22] - 2026-06-05

### Tests

- chore(cli): bump version and update @treeseed/sdk (373577004f92)

### Dependencies

- Release @treeseed/cli 0.10.22.

## [0.10.21] - 2026-06-04

### Tests

- build(source): sync package dependency references (bb99d336957a)

### Dependencies

- build(cli): update version and @treeseed/sdk dependency (9e5ac6c37d78)
- Release @treeseed/cli 0.10.21.

## [0.10.20] - 2026-06-04

### Infrastructure

- ci(build): record repository changes (a81b6c4559ac)

### Dependencies

- Release @treeseed/cli 0.10.20.

## [0.10.19] - 2026-06-04

### Tests

- chore(cli): bump version and update secret sensitivity in tests (9d816bed5162)
- chore(cli): bump version and refactor help test fixture resolution (90fe198d89cd)
- test(scripts): update SDK package root resolution logic (04ee9b423856)
- refactor(tests): improve SDK template catalog fixture resolution (c7c616ea866f)
- build(source): sync package dependency references (538372952d7a)

### Dependencies

- chore(cli): bump version and update @treeseed/sdk (d396d21e0e3a)
- chore(cli): bump version and update @treeseed/sdk dependency (033bc3d908a1)
- chore(deps): bump version and update @treeseed/sdk (8412542fd402)
- chore(cli): bump version and dependencies (b0a87b5c2ead)
- chore(cli): bump version and update @treeseed/sdk (306b51a031ce)
- build(cli): bump version and update @treeseed/sdk dependency (f9a436306093)
- Release @treeseed/cli 0.10.19.

## [0.10.18] - 2026-06-02

### Dependencies

- chore(cli): bump version and update @treeseed/sdk (374fdbb49d3b)
- build(cli): bump version and update @treeseed/sdk (1f702cff772a)
- Release @treeseed/cli 0.10.18.

## [0.10.17] - 2026-06-02

### Tests

- chore(cli): bump version and update configuration entries (388f8a60fcb5)

### Dependencies

- build(cli): bump version and update @treeseed/sdk (622fb1f70996)
- chore(cli): bump version and update @treeseed/sdk (7af40a2f48e5)
- build(cli): update version and @treeseed/sdk dependency (bb18012ed76d)
- chore(deps): bump version and update @treeseed/sdk (82c9279a8b69)
- build(cli): bump version and @treeseed/sdk dependency (34620418aa4d)
- build(cli): bump version and @treeseed/sdk dependency (e3836a031327)
- build(build): avoid Railway volume update after attach (e1857a1fbe35)
- build(build): harden Railway runner volume reconciliation (f0a9afba8548)
- Release @treeseed/cli 0.10.17.

## [0.10.16] - 2026-05-28

### Dependencies

- build(build): avoid live queue lookup during destroy dry runs (d1656120ecca)
- build(build): harden provider cleanup api calls for clean destroy (f375e4b9409e)
- build(build): wait for delayed Railway service instances before (fc9762f2201a)
- Release @treeseed/cli 0.10.16.

## [0.10.15] - 2026-05-28

### Dependencies

- build(build): force fresh deployed-resource verification on staging save (f150407744a0)
- build(build): refresh Railway topology during verification (e1eab6ffd17e)
- Release @treeseed/cli 0.10.15.

## [0.10.14] - 2026-05-28

### Dependencies

- build(build): redeploy staging from clean provider state (64026f118d9a)
- build(build): allow railway context link by project id (9b2825c79ae3)
- build(build): link railway context before cli volume fallback (386bb78746ed)
- build(build): fallback railway environment creation when API is opaque (1cafe12c532c)
- Release @treeseed/cli 0.10.14.

## [0.10.13] - 2026-05-28

### Dependencies

- build(build): stabilize clean redeploy railway volume verification (3fe92b104698)
- build(build): handle already mounted railway volumes during clean (a9c8734d2030)
- build(build): attach railway runner volume before verifying mount (5fbc17a1ae62)
- build(build): wait for railway service instance config to settle (5182400118d1)
- Release @treeseed/cli 0.10.13.

## [0.10.12] - 2026-05-28

### Dependencies

- build(build): use railway cli volume path for runner reconcile (0561b3872408)
- build(build): do not create replacement volumes for railway postgres (5d2c7fa5260d)
- build(build): reuse railway managed postgres volume after not (86c970513709)
- build(build): reuse railway postgres volume after create conflict (b6336a2edfd8)
- build(build): wait for new railway service instances before runtime (482d1d4c15f6)
- Release @treeseed/cli 0.10.12.

## [0.10.11] - 2026-05-28

### Dependencies

- build(build): retry railway volume attach during clean redeploy (b25ae92e0370)
- build(build): prove staging destroy save loop from clean providers (ed92acfa68b5)
- build(cli): update version and @treeseed/sdk dependency (f43f47703bbe)
- build(build): debug staging save from clean provider state (c58ad561ac01)
- build(build): debug staging save from clean provider state (4e4015824925)
- build(build): debug staging save from clean provider state (beeeb33f65f3)
- build(build): debug staging save from clean provider state (4276eb0ec1e8)
- build(build): debug staging save from clean provider state (b1a5a57d177c)
- build(build): debug staging save from clean provider state (c61c24169985)
- build(build): debug staging save from clean provider state (37aabb3d6b9b)
- build(build): debug staging save from clean provider state (ff84eb111f77)
- build(build): debug staging save from clean provider state (48bee0a3b39a)
- build(build): debug staging save from clean provider state (73197b403fcc)
- Release @treeseed/cli 0.10.11.

## [0.10.10] - 2026-05-27

### Dependencies

- Release @treeseed/cli 0.10.10.

## [0.10.9] - 2026-05-27

### Dependencies

- chore(cli): bump version and update @treeseed/sdk (ff979e05eaa5)
- Release @treeseed/cli 0.10.9.

## [0.10.8] - 2026-05-27

### Dependencies

- chore(cli): bump version and update @treeseed/sdk (7fd2050bf66d)
- Release @treeseed/cli 0.10.8.

## [0.10.7] - 2026-05-27

### Tests

- build(source): sync package dependency references (59a4ac589754)

### Dependencies

- chore(cli): bump version and update @treeseed/sdk (af50288a9cdc)
- build(cli): bump version and @treeseed/sdk dependency (c0a92fe8d5c3)
- build(build): sync package dependency references (7a62739b0448)
- chore(deps): update @treeseed/sdk and bump version (bb67e63483b3)
- Release @treeseed/cli 0.10.7.

## [0.10.6] - 2026-05-24

### Fixed

- build(build): fix sdk template source cache reuse (92a47d2b6f7e)

### Tests

- build(build): complete dynamic capacity budgeting (ec6ba454d0cb)

### Dependencies

- build(build): add market postgres baseline adoption columns (d98c5337d829)
- build(build): make market postgres baseline adopt existing schema (ee86268ad3d3)
- build(build): make static hub d1 baseline idempotent (7e902ab6d9c1)
- Release @treeseed/cli 0.10.6.

## [0.10.5] - 2026-05-23

### Dependencies

- Release @treeseed/cli 0.10.5.

## [0.10.4] - 2026-05-23

### Dependencies

- Release @treeseed/cli 0.10.4.

## [0.10.3] - 2026-05-23

### Dependencies

- build(cli): bump version to 0.10.3-dev.staging.20260523T002853Z (aa3348372a55)
- Release @treeseed/cli 0.10.3.

## [0.10.2] - 2026-05-22

### Dependencies

- build(cli): bump version and @treeseed/sdk dependency (6f8380e965c5)
- build(cli): bump version and update @treeseed/sdk dependency (d19eb3771525)
- build(cli): bump version and update @treeseed/sdk (b32e86527cee)
- Release @treeseed/cli 0.10.2.

## [0.10.1] - 2026-05-22

### Dependencies

- build(build): sync package dependency references (33c2dc0b2352)
- chore(cli): bump version and update @treeseed/sdk (b9943944852b)
- Release @treeseed/cli 0.10.1.

## [0.10.0] - 2026-05-21

### Fixed

- fix(build): rehearse repair releases against stable dependencies (fafb185f9231)
- fix(cli): allow repairVersionLine flag in release command (e0a4b78f3426)
- fix(release): add support for repairing package release line drift (f534b061d663)

### Dependencies

- Release @treeseed/cli 0.10.0.

## [0.9.3] - 2026-05-21

### Dependencies

- build(build): fail package release when npm publish fails (89e60c4023f9)
- Release @treeseed/cli 0.9.3.

## [0.9.2] - 2026-05-20

### Dependencies

- ci(build): create github releases for package publishes (cac082b30a34)
- Release @treeseed/cli 0.9.2.

## [0.9.1] - 2026-05-20

### Added

- feat(cli): complete capacity provider migration (f10339358792)

### Fixed

- fix(release): allow publish to succeed if npm scope is unprovisioned (a9e08605dd26)

### Dependencies

- build(build): tolerate npm scoped package permission 404 (a826d9adc50c)
- build(build): release internal packages from stable git tags (6984f1c7de98)
- build(build): complete capacity provider migration (e43638c2bee8)
- Release @treeseed/cli 0.9.1.

## [0.9.0] - 2026-05-19

### Tests

- chore(cli): update version and add dev command options (0011b0b16f9b)
- build(build): sync package dependency references (8b72be801c42)
- chore(cli): bump version and refactor seed test mocks (85bc3996ff41)

### Dependencies

- build(cli): bump version and @treeseed/sdk dependency (030e11cc4191)
- chore(cli): bump version and update @treeseed/sdk dependency (239dceb6374a)
- Release @treeseed/cli 0.9.0.

## [0.8.19] - 2026-05-16

### Dependencies

- Release @treeseed/cli 0.8.19.

## [0.8.18] - 2026-05-16

### Dependencies

- Release @treeseed/cli 0.8.18.

## [0.8.17] - 2026-05-16

### Dependencies

- Release @treeseed/cli 0.8.17.

## [0.8.16] - 2026-05-15

### Added

- feat(auth): sanitize loopback approval URLs for central profile (741ef25fcb5e)

### Tests

- chore(cli): bump version and update auth:login test (dff5b16975a7)

### Dependencies

- Release @treeseed/cli 0.8.16.

## [0.8.15] - 2026-05-15

### Tests

- chore(cli): bump version and update @treeseed/sdk dependency (1d46ea87ff65)

### Dependencies

- Release @treeseed/cli 0.8.15.

## [0.8.14] - 2026-05-15

### Added

- feat(seed): include capacity provider keys in seed response (116878333244)
- feat(cli): add seed command and tests (eda43bd11d49)

### Tests

- chore(cli): bump version to 0.8.14-dev.staging.20260515T061135Z (174ee229a189)
- test(cli): refactor seed tests and bump version (1fb521ed5b2b)
- build(source): sync package dependency references (2dbbb6b04aac)

### Dependencies

- build(cli): bump version and remove yaml dependency (85f9674a5299)
- Release @treeseed/cli 0.8.14.

## [0.8.13] - 2026-05-14

### Dependencies

- chore(cli): bump version to 0.8.13-dev.staging.20260514T074651Z (4ad144f5abfd)
- Release @treeseed/cli 0.8.13.

## [0.8.12] - 2026-05-14

### Dependencies

- build(cli): bump version to 0.8.12-dev.staging.20260514T023431Z (810ed486e289)
- Release @treeseed/cli 0.8.12.

## [0.8.11] - 2026-05-13

### Tests

- build(build): update package metadata (83d2975d0447)

### Dependencies

- build(cli): update package version and @treeseed/sdk dependency (2b1177877ab3)
- build(cli): update version and @treeseed/sdk dependency (ead315dd2ea2)
- Release @treeseed/cli 0.8.11.

## [0.8.10] - 2026-05-13

### Tests

- build(build): sync package dependency references (736269085614)

### Dependencies

- Release @treeseed/cli 0.8.10.

## [0.8.9] - 2026-05-12

### Dependencies

- build(cli): update version and @treeseed/sdk dependency (20b31ee60289)
- build(build): sync package dependency references (00f058e2b225)
- build(build): sync package dependency references (3fc5e3756384)
- build(build): sync package dependency references (2f1d3bb295b1)
- chore(cli): bump version and update @treeseed/sdk (8eb01fb0a14d)
- Release @treeseed/cli 0.8.9.

## [0.8.8] - 2026-05-11

### Dependencies

- build(build): sync package dependency references (a5be5c2352e9)
- build(source): sync package dependency references (428188d97070)
- Release @treeseed/cli 0.8.8.

## [0.8.7] - 2026-05-11

### Tests

- build(build): sync package dependency references (0cb6e2465876)

### Dependencies

- build(build): sync package dependency references (c3953adae339)
- build(cli): bump version and update @treeseed/sdk (e3ba68826453)
- Release @treeseed/cli 0.8.7.

## [0.8.6] - 2026-05-11

### Dependencies

- build(cli): bump version and update @treeseed/sdk (bcf21f085cfa)
- chore(cli): bump version and update sdk dependency (25a9b3191288)
- Release @treeseed/cli 0.8.6.

## [0.8.5] - 2026-05-11

### Dependencies

- chore(cli): bump version and update @treeseed/sdk (a4789e572aa6)
- build(cli): bump version and update @treeseed/sdk (dd06fab31dfe)
- Release @treeseed/cli 0.8.5.

## [0.8.4] - 2026-05-11

### Tests

- build(cli): bump version and update @treeseed/sdk (d2685c61abf9)
- build(build): sync package dependency references (7448f4507f69)

### Dependencies

- build(cli): bump version and @treeseed/sdk dependency (d669179f7f48)
- build(cli): bump version and @treeseed/sdk dependency (8bbc52d41b4e)
- build(cli): update version and @treeseed/sdk dependency (367e5672aefb)
- build(build): sync package dependency references (4f41216ec9c3)
- chore(cli): bump version and update @treeseed/sdk (6877749c3671)
- build(build): sync package dependency references (2bf04e7f7098)
- build(cli): update version and @treeseed/sdk dependency (fc15041930ce)
- build(cli): bump version and update @treeseed/sdk dependency (91212342ec15)
- build(cli): bump version and update @treeseed/sdk pointer (9ce75c86d1e0)
- build(cli): bump version and update @treeseed/sdk (047e9a12f895)
- build(cli): bump version and update @treeseed/sdk (41fcb4c20624)
- build(build): sync package dependency references (918b811df10b)
- build(build): sync package dependency references (cca20c8c872e)
- build(cli): bump version and update @treeseed/sdk dependency (08931d10f242)
- build(cli): update version and @treeseed/sdk dependency (8760189bf7cd)
- build(cli): bump version and update @treeseed/sdk dependency (05326fbdc557)
- chore(cli): bump version and update @treeseed/sdk (121dac2f91f8)
- build(build): sync package dependency references (1e893d40674a)
- chore(cli): bump version and update @treeseed/sdk (7587acbc5977)
- build(cli): update version and @treeseed/sdk dependency (94eb48602a34)
- 33 additional changes omitted from this summary.

## [0.8.3] - 2026-05-10

### Dependencies

- build(cli): bump version and update @treeseed/sdk (d1116ca3eadf)
- chore(cli): bump version and update @treeseed/sdk dependency (41bf98b068c2)
- Release @treeseed/cli 0.8.3.

## [0.8.2] - 2026-05-10

### Added

- feat(cli): add `audit hosting` command (b1c4d180bc9a)

### Dependencies

- Release @treeseed/cli 0.8.2.

## [0.8.1] - 2026-05-09

### Dependencies

- Release @treeseed/cli 0.8.1.

## [0.8.0] - 2026-05-09

### Dependencies

- build(cli): bump version and update @treeseed/sdk (a5aeab04e16b)
- Release @treeseed/cli 0.8.0.

## [0.7.0] - 2026-05-09

### Dependencies

- chore(cli): bump version and update @treeseed/sdk (7a9557fb0513)
- Release @treeseed/cli 0.7.0.

## [0.6.47] - 2026-05-09

### Tests

- build(build): sync package dependency references (275e085a959d)

### Dependencies

- Release @treeseed/cli 0.6.47.

## [0.6.46] - 2026-05-08

### Infrastructure

- chore(cli): bump version to 0.6.46-dev.staging.20260508T202431Z (dd3f2072ba65)

### Dependencies

- Release @treeseed/cli 0.6.46.

## [0.6.45] - 2026-05-08

### Dependencies

- chore(cli): bump version and update @treeseed/sdk (a57e1eada521)
- Release @treeseed/cli 0.6.45.

## [0.6.44] - 2026-05-08

### Dependencies

- chore(cli): bump version and update @treeseed/sdk (1a9bd7a781f0)
- Release @treeseed/cli 0.6.44.

## [0.6.43] - 2026-05-08

### Dependencies

- build(cli): bump version to 0.6.43-dev.staging.20260508T184742Z (56fc7061aefb)
- Release @treeseed/cli 0.6.43.

## [0.6.42] - 2026-05-08

### Dependencies

- chore(cli): bump version and update @treeseed/sdk (1285ce0898f9)
- Release @treeseed/cli 0.6.42.

## [0.6.41] - 2026-05-08

### Added

- feat(ci): display active jobs and steps in pending workflows (554386ea9a2c)

### Dependencies

- Release @treeseed/cli 0.6.41.

## [0.6.40] - 2026-05-08

### Added

- feat(cli): select Railway environment before forwarding args (163d5c8efe09)

### Dependencies

- Release @treeseed/cli 0.6.40.

## [0.6.39] - 2026-05-08

### Dependencies

- chore(cli): bump version and update @treeseed/sdk (60a1e8bb3f27)
- Release @treeseed/cli 0.6.39.

## [0.6.38] - 2026-05-08

### Dependencies

- build(cli): update version and @treeseed/sdk dependency (6324656d9821)
- Release @treeseed/cli 0.6.38.

## [0.6.37] - 2026-05-08

### Dependencies

- chore(cli): bump version and update @treeseed/sdk (f84383aba474)
- Release @treeseed/cli 0.6.37.

## [0.6.36] - 2026-05-08

### Added

- feat(cli): add provider cli wrappers and refresh railway sdk lock (ea24f06dc0d1)
### Dependencies

- build(build): sync package dependency references (21fdd5d1118a)
- build(cli): bump version and update @treeseed/sdk (eb7870fb0edd)
- chore(cli): bump version and update @treeseed/sdk (e80ab05f0782)
- chore(cli): update version and @treeseed/sdk dependency (39a48402a7ab)
- build(cli): bump version and @treeseed/sdk dependency (57edacfb8dc2)
- build(cli): bump version and update @treeseed/sdk dependency (b29cd10e6017)
- Release @treeseed/cli 0.6.36.

## [0.6.35] - 2026-05-07

### Dependencies

- chore(cli): bump version and update @treeseed/sdk dependency (ec81c8e338ae)
- Release @treeseed/cli 0.6.35.

## [0.6.34] - 2026-05-07

### Tests

- build(cli): bump version to 0.6.34-dev.staging.20260507T204232Z (f104164d5a65)

### Dependencies

- Release @treeseed/cli 0.6.34.

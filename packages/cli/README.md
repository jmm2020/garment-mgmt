# gm — Garment Management CLI

Operator CLI for the garment-mgmt Production Hub. All commands speak to the Fastify HTTP API
(`http://localhost:3000` by default). Override the target with `--host <url>` on `gm login` or
by setting `GM_API_HOST` in the environment.

**Session:** credentials are persisted to `~/.garment-mgmt/session` after a successful login.
Every subsequent command reads that file to attach the session cookie. Re-run `gm login` to
refresh after expiry.

---

### login / logout

| Command            | Flags                                                    | Notes                                                               |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------- |
| `gm login <email>` | `--password <pw>` (or `GM_PASSWORD` env), `--host <url>` | Authenticates and writes session token to `~/.garment-mgmt/session` |
| `gm logout`        | —                                                        | Drops the local session file                                        |

Example:

```bash
gm login admin@example.com --password dev
```

---

### vendors

| Command           | Flags | Notes            |
| ----------------- | ----- | ---------------- |
| `gm vendors list` | —     | List all vendors |

---

### materials

| Command             | Flags | Notes              |
| ------------------- | ----- | ------------------ |
| `gm materials list` | —     | List all materials |

---

### bom

| Command            | Flags | Notes                        |
| ------------------ | ----- | ---------------------------- |
| `gm bom show <id>` | —     | Show BOM with its components |

---

### po

| Command                  | Flags           | Notes                                                   |
| ------------------------ | --------------- | ------------------------------------------------------- |
| `gm po list`             | —               | List purchase orders                                    |
| `gm po show <id>`        | —               | Show PO with lines                                      |
| `gm po receive <lineId>` | — (reads stdin) | Receive lots against a PO line; stdin: `{"lots":[...]}` |

Example receive payload (stdin):

```json
{ "lots": [{ "dyeLot": "DL-001", "qty": "50.000", "unitCost": "12.5000" }] }
```

---

### ct (cut tickets)

| Command            | Flags           | Notes                                    |
| ------------------ | --------------- | ---------------------------------------- |
| `gm ct list`       | —               | List cut tickets                         |
| `gm ct create`     | — (reads stdin) | Create cut ticket; stdin: JSON body      |
| `gm ct show <id>`  | —               | Cut ticket with allocations              |
| `gm ct close <id>` | — (reads stdin) | Close ticket; stdin: `{"actuals":[...]}` |

---

### lot

| Command                  | Flags | Notes                                        |
| ------------------------ | ----- | -------------------------------------------- |
| `gm lot provenance <id>` | —     | Walk lot → PO line → PO → vendor + movements |

---

### batch

| Command                     | Flags                                                                                                                                           | Notes                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `gm batch receive`          | `--cut-ticket <id>` (required), `--variant <id>` (required), `--qty <qty>` (required), `--cutter <userId>` (required), `--notes <n>`, `--force` | Create a batch from the cutter. `--force` bypasses the PVT gate and records an override audit row.                      |
| `gm batch list`             | `--status <s>`, `--sku <sku>`, `--since <iso>`, `--cutter <userId>`                                                                             | List batches with optional filters                                                                                      |
| `gm batch show <ref>`       | —                                                                                                                                               | Show batch detail by id or `PB-YYYY-####`                                                                               |
| `gm batch find [<batchNo>]` | `--order <shopifyOrderId>`                                                                                                                      | Forensic lookup by `PB-YYYY-####`; or with `--order` reverse-lookup Shopify order → batches + cut tickets + fabric lots |
| `gm batch stage <ref>`      | —                                                                                                                                               | Advance: `received_from_cutter → staged_pre_prod`                                                                       |
| `gm batch start <ref>`      | —                                                                                                                                               | Advance: `staged_pre_prod → in_production`                                                                              |
| `gm batch submit-qc <ref>`  | `--qty <qty>` (required)                                                                                                                        | Advance: `in_production → awaiting_qc`                                                                                  |
| `gm batch complete <ref>`   | `--qty <qty>` (required), `--verdict <v>` (required), `--note <n>`                                                                              | Advance: `awaiting_qc → completed`; records QC verdict and triggers Shopify inventory push                              |
| `gm batch cancel <ref>`     | `--reason <r>` (required)                                                                                                                       | Cancel a non-terminal batch                                                                                             |
| `gm batch assign <ref>`     | `--line <sewLineId>` (required)                                                                                                                 | Assign batch to a sew line (metadata, not a status change)                                                              |
| `gm batch release <ref>`    | —                                                                                                                                               | Release batch from its current sew line                                                                                 |

Verdict values: `pass`, `fail`, `pass_with_notes`.

Example — receive a batch and advance it through production:

```bash
gm batch receive --cut-ticket 7 --variant 3 --qty 100 --cutter 2
gm batch stage PB-2026-0001
gm batch start PB-2026-0001
gm batch submit-qc PB-2026-0001 --qty 98
gm batch complete PB-2026-0001 --qty 98 --verdict pass
```

---

### pvt

Production Validation Testing — authorizes a (variant, marker) pair for full production.

| Command                     | Flags                                                                                                                                  | Notes                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `gm pvt create`             | `--variant <id>` (required), `--marker <id>` (required), `--cutter <userId>` (required), `--cut-ticket <id>` (required), `--notes <n>` | Create a new PVT run; cut ticket must have `kind='pvt'`                     |
| `gm pvt list`               | `--status <s>`, `--variant <id>`, `--active-only`                                                                                      | List PVT runs; `--active-only` filters to authorized/in-progress runs only  |
| `gm pvt show <ref>`         | —                                                                                                                                      | Show PVT run by id or `PVT-YYYY-####`                                       |
| `gm pvt ship <ref>`         | —                                                                                                                                      | Advance: `cutting → shipped`                                                |
| `gm pvt receive <ref>`      | —                                                                                                                                      | Advance: `shipped → inspecting`                                             |
| `gm pvt validate <ref>`     | `--notes <n>`                                                                                                                          | Advance: `inspecting → validated` (opens the production gate)               |
| `gm pvt reject <ref>`       | `--reason <r>` (required)                                                                                                              | Advance: `inspecting → rejected` (gate stays closed; a new PVT must be cut) |
| `gm pvt cancel <ref>`       | `--reason <r>` (required)                                                                                                              | Cancel a non-terminal PVT run                                               |
| `gm pvt status <variantId>` | `--marker <id>` (required)                                                                                                             | Check whether (variant, marker) is currently authorized for production      |

Status values: `cutting`, `shipped`, `inspecting`, `validated`, `rejected`, `cancelled`.

Example — run a PVT and authorize production:

```bash
gm pvt create --variant 3 --marker 1 --cutter 2 --cut-ticket 8
gm pvt ship PVT-2026-0001
gm pvt receive PVT-2026-0001
gm pvt validate PVT-2026-0001 --notes "Seams and dimensions pass"
gm pvt status 3 --marker 1   # → authorized: true
```

---

### unit

Per-unit tracking within a completed or in-QC batch.

| Command                         | Flags                                      | Notes                                                                               |
| ------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `gm unit show <serial>`         | —                                          | Show unit provenance by serial number                                               |
| `gm unit list <batchId>`        | `--verdict <v>`                            | List units for a batch; `--verdict` filters by `pass`, `fail`, or `pass_with_notes` |
| `gm unit qc <batchId> <serial>` | `--verdict <v>` (required), `--reason <r>` | Record per-unit QC verdict; `--reason` is recommended when `verdict=fail`           |

Verdict values: `pass`, `fail`, `pass_with_notes`.

Example:

```bash
gm unit list 42
gm unit qc 42 UNIT-0001 --verdict fail --reason "collar misaligned"
gm unit show UNIT-0001
```

---

### line

| Command             | Flags                            | Notes                                        |
| ------------------- | -------------------------------- | -------------------------------------------- |
| `gm line list`      | —                                | List all sew lines with machine counts       |
| `gm line show <id>` | —                                | Show sew line detail including machines      |
| `gm line load <id>` | `--date <YYYY-MM-DD>` (required) | Show planned load for a line on a given date |
